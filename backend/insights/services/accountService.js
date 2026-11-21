// Companies / teams
import { Account } from "../models/Account.js";
import { Entry } from "../models/Entry.js";
import { DEFAULT_ACCOUNTS } from "../constants/metrics.js";
import { badRequest, notFound } from "../utils/httpError.js";

// Adds the default companies the first time the app runs
export async function ensureDefaultAccounts() {
  if ((await Account.countDocuments()) > 0) return;
  await Account.insertMany(DEFAULT_ACCOUNTS.map((name) => ({ name, key: name.toLowerCase() })));
}

export async function listAccounts() {
  return Account.find().sort({ createdAt: 1 });
}

// Returns the existing account if the name already exists (any letter case)
export async function addAccount(rawName) {
  const name = String(rawName || "").trim();
  if (!name) throw badRequest("Company name is required");
  if (name.length > 60) throw badRequest("Company name is too long (max 60 characters)");
  const key = name.toLowerCase();
  const existing = await Account.findOne({ key });
  if (existing) return { account: existing, created: false };
  return { account: await Account.create({ name, key }), created: true };
}

export async function renameAccount(id, rawName) {
  const name = String(rawName || "").trim();
  if (!name) throw badRequest("Company name is required");
  const account = await Account.findById(id);
  if (!account) throw notFound("Company not found");
  const clash = await Account.findOne({ key: name.toLowerCase(), _id: { $ne: id } });
  if (clash) throw badRequest("A company with this name already exists");
  const oldName = account.name;
  account.name = name;
  account.key = name.toLowerCase();
  await account.save();
  await Entry.updateMany({ account: oldName }, { $set: { account: name } }); // keep entries linked
  return account;
}

// Only allowed when the company has no saved data
export async function deleteAccount(id) {
  const account = await Account.findById(id);
  if (!account) throw notFound("Company not found");
  const used = await Entry.countDocuments({ account: account.name });
  if (used) throw badRequest(`"${account.name}" has ${used} saved entries — delete them first`);
  await account.deleteOne();
}
