module.exports = function registerStage5Routes(app, deps) {
  const { db, auth, requireRole, audit } = deps;
  app.get("/api/groups", auth, async (req,res) => {
    const q = await db().query("select id,chain_id,contract_address,onchain_group_id,name,country,status,metadata,created_at from groups order by created_at desc");
    res.json({groups:q.rows});
  });
};
