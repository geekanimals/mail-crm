// HTTP layer for companies / teams
import * as accounts from "../services/accountService.js";

export async function list(_req, res) {
  res.json({ accounts: await accounts.listAccounts() });
}

export async function create(req, res) {
  const { account, created } = await accounts.addAccount(req.body?.name);
  res.status(created ? 201 : 200).json({ account, created });
}

export async function rename(req, res) {
  res.json({ account: await accounts.renameAccount(req.params.id, req.body?.name) });
}

export async function remove(req, res) {
  await accounts.deleteAccount(req.params.id);
  res.json({ deleted: true });
}
