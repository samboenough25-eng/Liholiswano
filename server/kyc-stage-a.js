const crypto = require("crypto");
const { z } = require("zod");

const KYC_STATUSES = new Set(["pending","approved","rejected","needs_review","error"]);
const DOCUMENT_TYPES = new Set(["identity_front","identity_back","passport"]);
const ALLOWED_DOC_MIME = new Set(["image/jpeg","image/png","application/pdf"]);
const CONSENT_VERSION = "stage-a-v1";

function installStageAKyc({ app, db, auth, requireRole, audit }) {
  const query = (...args) => db().query(...args);

  async function event(caseId, actorUserId, eventType, fromStatus, toStatus, details = {}) {
    await query(
      "insert into kyc_events(case_id,actor_user_id,event_type,from_status,to_status,details) values($1,$2,$3,$4,$5,$6)",
      [caseId, actorUserId || null, eventType, fromStatus || null, toStatus || null, JSON.stringify(details)]
    );
  }

  async function getCase(caseId) {
    const q = await query(
      `select k.*,u.email,u.country as account_country
       from kyc_cases k join users u on u.id=k.user_id where k.id=$1`,
      [caseId]
    );
    return q.rows[0] || null;
  }

  function configuredProvider() {
    return String(process.env.KYC_PROVIDER || "stage-a-manual").trim().toLowerCase();
  }

  function providerCapabilities() {
    const provider = configuredProvider();
    return {
      provider,
      mode: provider === "stage-a-manual" || provider === "manual" || provider === "sandbox" ? "sandbox_manual" : "external",
      realIdentityVerification: false,
      realBiometricLiveness: false,
      realDocumentDatabaseCheck: false,
      realSanctionsScreening: false,
      externalProviderConfigured: Boolean(process.env.KYC_PROVIDER_API_URL && process.env.KYC_PROVIDER_API_KEY)
    };
  }

  function normalizeCaseStatus(status) {
    return KYC_STATUSES.has(status) ? status : "error";
  }

  function transitionAllowed(from, to) {
    const allowed = {
      pending: new Set(["pending","needs_review","approved","rejected","error"]),
      needs_review: new Set(["needs_review","approved","rejected","error","pending"]),
      error: new Set(["error","pending","needs_review"]),
      approved: new Set(["approved","needs_review"]),
      rejected: new Set(["rejected","pending","needs_review"])
    };
    return Boolean(allowed[from] && allowed[from].has(to));
  }

  app.get("/api/kyc/stage-a", auth, async (req, res) => {
    try {
      const cases = await query(
        `select id,provider,status,workflow_status,provider_reference,country,submitted_at,
                reviewed_at,review_reason,risk_level,consent_version,consented_at,
                decision_source,external_session_url,created_at,updated_at
         from kyc_cases where user_id=$1 order by created_at desc`,
        [req.user.id]
      );
      const latest = cases.rows[0] || null;
      let identity = null;
      let documents = [];
      let events = [];
      if (latest) {
        const iq = await query(
          `select id,legal_first_name,legal_last_name,date_of_birth,document_type,
                  document_country,document_last4,residential_city,consent_version,consented_at,created_at
           from kyc_identity_submissions where case_id=$1`,
          [latest.id]
        );
        identity = iq.rows[0] || null;
        const dq = await query(
          `select id,document_type,original_filename,content_type,byte_size,sha256,
                  storage_status,provider_reference,created_at
           from kyc_documents where case_id=$1 order by created_at desc`,
          [latest.id]
        );
        documents = dq.rows;
        const eq = await query(
          `select id,event_type,from_status,to_status,details,created_at
           from kyc_events where case_id=$1 order by created_at desc limit 100`,
          [latest.id]
        );
        events = eq.rows;
      }
      res.json({
        status: req.user.kyc_status,
        provider: providerCapabilities(),
        consentVersion: CONSENT_VERSION,
        latestCase: latest,
        identity,
        documents,
        events
      });
    } catch (e) {
      console.error("Stage A KYC status failed", e);
      res.status(500).json({ error: "Unable to load KYC status" });
    }
  });

  app.post("/api/kyc/stage-a/cases", auth, async (req, res) => {
    try {
      const existing = await query(
        "select id,status from kyc_cases where user_id=$1 order by created_at desc limit 1",
        [req.user.id]
      );
      if (existing.rowCount && ["pending","needs_review"].includes(existing.rows[0].status)) {
        return res.status(409).json({ error: "An active KYC case already exists", caseId: existing.rows[0].id });
      }

      const provider = configuredProvider();
      const country = req.user.country;
      const q = await query(
        `insert into kyc_cases(user_id,provider,country,status,workflow_status,decision_source)
         values($1,$2,$3,'pending','pending','manual_stage_a')
         returning id,status,workflow_status,provider,country,created_at`,
        [req.user.id, provider, country]
      );
      const k = q.rows[0];
      await event(k.id, req.user.id, "case_created", null, "pending", { provider, country });
      await audit(req.user.id, "kyc.stage_a_case_created", "kyc_case", k.id, { provider, country });
      res.status(201).json({
        case: k,
        provider: providerCapabilities(),
        nextStep: "identity_submission"
      });
    } catch (e) {
      console.error("Stage A KYC case creation failed", e);
      res.status(500).json({ error: "Unable to start KYC" });
    }
  });

  app.post("/api/kyc/stage-a/cases/:id/identity", auth, async (req, res) => {
    const schema = z.object({
      firstName: z.string().trim().min(1).max(100),
      lastName: z.string().trim().min(1).max(100),
      dateOfBirth: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/),
      documentType: z.enum(["national_id","passport"]),
      documentCountry: z.enum(["BW","SZ"]),
      documentLast4: z.string().regex(/^\\d{4}$/).optional(),
      residentialCity: z.string().trim().max(100).optional(),
      consent: z.literal(true)
    });
    try {
      const b = schema.parse(req.body);
      const k = await getCase(req.params.id);
      if (!k || k.user_id !== req.user.id) return res.status(404).json({ error: "KYC case not found" });
      if (!["pending","needs_review"].includes(k.status)) return res.status(409).json({ error: "This KYC case cannot be edited in its current state" });
      if (b.documentCountry !== req.user.country) return res.status(400).json({ error: "Document country must match the account country" });

      const dob = new Date(b.dateOfBirth + "T00:00:00Z");
      if (Number.isNaN(dob.getTime()) || dob > new Date()) return res.status(400).json({ error: "Invalid date of birth" });

      await query(
        `insert into kyc_identity_submissions
          (case_id,user_id,legal_first_name,legal_last_name,date_of_birth,document_type,document_country,
           document_last4,residential_city,consent_version,consented_at)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
         on conflict(case_id) do update set
           legal_first_name=excluded.legal_first_name,legal_last_name=excluded.legal_last_name,
           date_of_birth=excluded.date_of_birth,document_type=excluded.document_type,
           document_country=excluded.document_country,document_last4=excluded.document_last4,
           residential_city=excluded.residential_city,consent_version=excluded.consent_version,
           consented_at=excluded.consented_at`,
        [k.id, req.user.id, b.firstName, b.lastName, b.dateOfBirth, b.documentType, b.documentCountry,
         b.documentLast4 || null, b.residentialCity || null, CONSENT_VERSION]
      );

      await query(
        "update kyc_cases set consent_version=$2,consented_at=now(),updated_at=now() where id=$1",
        [k.id, CONSENT_VERSION]
      );
      await event(k.id, req.user.id, "identity_submitted", k.status, k.status, {
        documentType: b.documentType,
        documentCountry: b.documentCountry,
        consentVersion: CONSENT_VERSION
      });
      await audit(req.user.id, "kyc.identity_submitted", "kyc_case", k.id, {
        documentType: b.documentType,
        documentCountry: b.documentCountry
      });
      res.json({ saved: true, caseId: k.id, consentVersion: CONSENT_VERSION });
    } catch (e) {
      if (e.name === "ZodError") return res.status(400).json({ error: "Invalid identity information", details: e.issues.map(x => x.path.join(".") + ": " + x.message) });
      console.error("Stage A identity submission failed", e);
      res.status(500).json({ error: "Unable to save identity information" });
    }
  });

  app.post("/api/kyc/stage-a/cases/:id/documents/metadata", auth, async (req, res) => {
    const schema = z.object({
      documentType: z.enum(["identity_front","identity_back","passport"]),
      filename: z.string().trim().min(1).max(255),
      contentType: z.string().trim().max(100),
      byteSize: z.number().int().positive().max(10 * 1024 * 1024),
      sha256: z.string().regex(/^[a-fA-F0-9]{64}$/)
    });
    try {
      const b = schema.parse(req.body);
      const k = await getCase(req.params.id);
      if (!k || k.user_id !== req.user.id) return res.status(404).json({ error: "KYC case not found" });
      if (!["pending","needs_review"].includes(k.status)) return res.status(409).json({ error: "This KYC case cannot accept documents" });
      if (!DOCUMENT_TYPES.has(b.documentType) || !ALLOWED_DOC_MIME.has(b.contentType)) return res.status(400).json({ error: "Unsupported document type" });
      const q = await query(
        `insert into kyc_documents(case_id,user_id,document_type,original_filename,content_type,byte_size,sha256,storage_status)
         values($1,$2,$3,$4,$5,$6,$7,'metadata_only')
         returning id,document_type,original_filename,content_type,byte_size,sha256,storage_status,created_at`,
        [k.id, req.user.id, b.documentType, b.filename, b.contentType, b.byteSize, b.sha256]
      );
      await event(k.id, req.user.id, "document_metadata_added", k.status, k.status, { documentId: q.rows[0].id, documentType: b.documentType });
      await audit(req.user.id, "kyc.document_metadata_added", "kyc_case", k.id, { documentId: q.rows[0].id, documentType: b.documentType });
      res.status(201).json({
        document: q.rows[0],
        stored: false,
        message: "Document metadata recorded. Stage A does not persist identity documents until secure object storage is configured."
      });
    } catch (e) {
      if (e.name === "ZodError") return res.status(400).json({ error: "Invalid document metadata", details: e.issues.map(x => x.path.join(".") + ": " + x.message) });
      console.error("Stage A document metadata failed", e);
      res.status(500).json({ error: "Unable to record document metadata" });
    }
  });

  app.post("/api/kyc/stage-a/cases/:id/submit", auth, async (req, res) => {
    try {
      const k = await getCase(req.params.id);
      if (!k || k.user_id !== req.user.id) return res.status(404).json({ error: "KYC case not found" });
      if (!["pending","needs_review"].includes(k.status)) return res.status(409).json({ error: "This KYC case has already reached a final state" });
      const identity = await query("select id from kyc_identity_submissions where case_id=$1", [k.id]);
      if (!identity.rowCount) return res.status(400).json({ error: "Complete the identity information before submitting KYC" });
      if (!k.consent_version || !k.consented_at) return res.status(400).json({ error: "KYC consent is required before submission" });

      const from = k.status;
      await query("update kyc_cases set status='needs_review',workflow_status='needs_review',submitted_at=coalesce(submitted_at,now()),updated_at=now(),decision_source='manual_stage_a' where id=$1", [k.id]);
      await query("update users set kyc_status='needs_review',updated_at=now() where id=$1", [req.user.id]);
      await event(k.id, req.user.id, "submitted_for_review", from, "needs_review");
      await audit(req.user.id, "kyc.submitted_for_review", "kyc_case", k.id);
      res.json({ submitted: true, status: "needs_review", caseId: k.id });
    } catch (e) {
      console.error("Stage A KYC submission failed", e);
      res.status(500).json({ error: "Unable to submit KYC case" });
    }
  });

  app.get("/api/admin/kyc/stage-a/cases", auth, requireRole(["admin","compliance"]), async (req, res) => {
    try {
      const status = String(req.query.status || "").trim();
      const values = [];
      let where = "";
      if (status && KYC_STATUSES.has(status)) { values.push(status); where = "where k.status=$1"; }
      const q = await query(
        `select k.id,k.user_id,u.email,u.country,k.provider,k.status,k.workflow_status,k.provider_reference,
                k.submitted_at,k.reviewed_at,k.review_reason,k.risk_level,k.consent_version,k.decision_source,
                k.created_at,k.updated_at
         from kyc_cases k join users u on u.id=k.user_id
         ${where} order by coalesce(k.submitted_at,k.created_at) desc limit 500`,
        values
      );
      res.json({ cases: q.rows, provider: providerCapabilities() });
    } catch (e) {
      console.error("Stage A admin cases failed", e);
      res.status(500).json({ error: "Unable to load KYC cases" });
    }
  });

  app.get("/api/admin/kyc/stage-a/cases/:id", auth, requireRole(["admin","compliance"]), async (req, res) => {
    try {
      const k = await getCase(req.params.id);
      if (!k) return res.status(404).json({ error: "KYC case not found" });
      const [identity, documents, events] = await Promise.all([
        query("select id,legal_first_name,legal_last_name,date_of_birth,document_type,document_country,document_last4,residential_city,consent_version,consented_at,created_at from kyc_identity_submissions where case_id=$1", [k.id]),
        query("select id,document_type,original_filename,content_type,byte_size,sha256,storage_status,provider_reference,created_at from kyc_documents where case_id=$1 order by created_at desc", [k.id]),
        query("select id,event_type,from_status,to_status,details,created_at from kyc_events where case_id=$1 order by created_at desc limit 200", [k.id])
      ]);
      res.json({ case: k, identity: identity.rows[0] || null, documents: documents.rows, events: events.rows });
    } catch (e) {
      console.error("Stage A admin case detail failed", e);
      res.status(500).json({ error: "Unable to load KYC case" });
    }
  });

  app.post("/api/admin/kyc/stage-a/cases/:id/decision", auth, requireRole(["admin","compliance"]), async (req, res) => {
    const schema = z.object({
      status: z.enum(["approved","rejected","needs_review"]),
      reason: z.string().trim().max(2000).optional(),
      riskLevel: z.enum(["low","medium","high"]).optional()
    });
    try {
      const b = schema.parse(req.body);
      const k = await getCase(req.params.id);
      if (!k) return res.status(404).json({ error: "KYC case not found" });
      if (!transitionAllowed(k.status, b.status)) return res.status(409).json({ error: "Invalid KYC state transition" });
      if (b.status === "approved") {
        const identity = await query("select id from kyc_identity_submissions where case_id=$1", [k.id]);
        if (!identity.rowCount) return res.status(400).json({ error: "Identity information is required before approval" });
        if (!k.consented_at) return res.status(400).json({ error: "KYC consent is required before approval" });
      }
      const from = k.status;
      await query(
        `update kyc_cases
         set status=$2,workflow_status=$2,reviewed_at=now(),review_reason=$3,risk_level=$4,
             decision_source='manual_stage_a',updated_at=now()
         where id=$1`,
        [k.id, b.status, b.reason || null, b.riskLevel || null]
      );
      await query("update users set kyc_status=$2,updated_at=now() where id=$1", [k.user_id, b.status]);
      await event(k.id, req.user.id, "manual_decision", from, b.status, { reason: b.reason || null, riskLevel: b.riskLevel || null });
      await audit(req.user.id, "kyc.stage_a_decision", "kyc_case", k.id, { status: b.status, riskLevel: b.riskLevel || null });
      res.json({ decided: true, caseId: k.id, status: b.status });
    } catch (e) {
      if (e.name === "ZodError") return res.status(400).json({ error: "Invalid KYC decision" });
      console.error("Stage A KYC decision failed", e);
      res.status(500).json({ error: "Unable to apply KYC decision" });
    }
  });

  app.get("/api/admin/kyc/stage-a/audit/:id", auth, requireRole(["admin","compliance"]), async (req, res) => {
    try {
      const q = await query(
        `select e.id,e.event_type,e.from_status,e.to_status,e.details,e.created_at,
                u.email as actor_email
         from kyc_events e left join users u on u.id=e.actor_user_id
         where e.case_id=$1 order by e.created_at asc`,
        [req.params.id]
      );
      res.json({ events: q.rows });
    } catch (e) {
      res.status(500).json({ error: "Unable to load KYC audit history" });
    }
  });

  // Provider-neutral webhook boundary. Real providers can be connected later without changing
  // customer-facing routes. Requests must include X-Liholiswano-KYC-Signature = HMAC-SHA256(rawBody).
  app.post("/api/kyc/webhook", async (req, res) => {
    try {
      const secret = process.env.KYC_WEBHOOK_SECRET;
      if (!secret) return res.status(503).json({ error: "KYC webhook security is not configured" });
      const raw = req.rawBody;
      const supplied = String(req.headers["x-liholiswano-kyc-signature"] || "");
      if (!raw || !supplied) return res.status(401).json({ error: "Missing webhook signature" });
      const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
      if (!/^[a-f0-9]{64}$/i.test(supplied) || !crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"))) {
        return res.status(401).json({ error: "Invalid webhook signature" });
      }

      const payload = req.body || {};
      const provider = String(payload.provider || configuredProvider()).slice(0,64);
      const eventId = String(payload.eventId || payload.id || "").trim();
      const providerReference = String(payload.providerReference || payload.reference || "").trim().slice(0,255);
      const eventType = String(payload.eventType || "status").trim().slice(0,96);
      const status = normalizeCaseStatus(String(payload.status || "needs_review"));
      if (!eventId || !providerReference) return res.status(400).json({ error: "eventId and providerReference are required" });

      const payloadHash = crypto.createHash("sha256").update(raw).digest("hex");
      const existing = await query("select id,processed_at from kyc_provider_events where provider=$1 and provider_event_id=$2", [provider, eventId]);
      if (existing.rowCount) return res.status(200).json({ received: true, duplicate: true, processedAt: existing.rows[0].processed_at });

      await query(
        `insert into kyc_provider_events(provider,provider_event_id,provider_reference,event_type,signature_valid,payload_hash,payload)
         values($1,$2,$3,$4,true,$5,$6)`,
        [provider,eventId,providerReference,eventType,payloadHash,JSON.stringify(payload)]
      );
      const kq = await query("select * from kyc_cases where provider=$1 and provider_reference=$2 order by created_at desc limit 1", [provider,providerReference]);
      if (!kq.rowCount) {
        await query("update kyc_provider_events set processed_at=now() where provider=$1 and provider_event_id=$2", [provider,eventId]);
        return res.status(202).json({ received: true, matched: false });
      }

      const k = kq.rows[0];
      if (!transitionAllowed(k.status, status)) return res.status(409).json({ error: "Invalid provider status transition" });
      await query(
        "update kyc_cases set status=$2,workflow_status=$2,reviewed_at=case when $2 in ('approved','rejected') then now() else reviewed_at end,updated_at=now(),decision_source='provider' where id=$1",
        [k.id,status]
      );
      await query("update users set kyc_status=$2,updated_at=now() where id=$1", [k.user_id,status]);
      await event(k.id,null,"provider_webhook",k.status,status,{provider,eventId,eventType});
      await query("update kyc_provider_events set processed_at=now() where provider=$1 and provider_event_id=$2", [provider,eventId]);
      res.status(200).json({ received: true, matched: true, status });
    } catch (e) {
      console.error("KYC webhook failed", e);
      res.status(500).json({ error: "Unable to process KYC webhook" });
    }
  });
}

module.exports = { installStageAKyc, CONSENT_VERSION };
