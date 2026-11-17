// Employee portal / HR: attendance, leaves, holidays, tasks, weekly reports, targets, documents, payslips.
// Every record belongs to one employee (a User with role "team"). Days are "YYYY-MM-DD" in the office time zone.
import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const id = Schema.Types.ObjectId;
const file = { _id: false, id: { type: id, ref: 'HrFile' }, name: String, size: Number, type: { type: String } };

// An uploaded file (report, target sheet, document). Stored on the server disk, read through /api/files/:id.
export const HrFile = model(
  'HrFile',
  new Schema(
    {
      owner: { type: id, ref: 'User', index: true }, // the employee it belongs to (they can read it)
      name: String,
      type: String,
      size: Number,
      path: String, // file name inside UPLOAD_DIR
      uploadedBy: String,
    },
    { timestamps: true }
  )
);

// One row per employee per day. A correction request (forgot to check out, wrong time) waits for the admin.
const attendanceSchema = new Schema(
  {
    user: { type: id, ref: 'User', required: true, index: true },
    day: { type: String, required: true }, // YYYY-MM-DD
    checkIn: Date,
    checkOut: Date,
    note: { type: String, default: '' },
    request: {
      checkIn: Date,
      checkOut: Date,
      note: String,
      status: { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
      at: Date,
    },
    editedBy: String, // set when the admin changed the times
  },
  { timestamps: true }
);
attendanceSchema.index({ user: 1, day: 1 }, { unique: true });
export const Attendance = model('Attendance', attendanceSchema);

// Leave request. Days beyond the paid balance are unpaid (salary cut).
export const Leave = model(
  'Leave',
  new Schema(
    {
      user: { type: id, ref: 'User', required: true, index: true },
      from: { type: String, required: true }, // YYYY-MM-DD
      to: { type: String, required: true },
      half: { type: Boolean, default: false }, // half day (from = to)
      days: Number, // working days asked for (Sundays and holidays not counted)
      paidDays: { type: Number, default: 0 }, // set when approved
      unpaidDays: { type: Number, default: 0 },
      reason: { type: String, default: '' },
      status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
      adminNote: { type: String, default: '' },
      decidedAt: Date,
    },
    { timestamps: true }
  )
);

export const Holiday = model('Holiday', new Schema({ day: { type: String, unique: true }, name: String }, { timestamps: true }));

// Work given by the admin to one employee
export const HrTask = model(
  'HrTask',
  new Schema(
    {
      user: { type: id, ref: 'User', required: true, index: true },
      title: { type: String, required: true },
      details: { type: String, default: '' },
      due: { type: String, default: '' }, // YYYY-MM-DD
      priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
      status: { type: String, enum: ['todo', 'doing', 'done'], default: 'todo', index: true },
      comments: [{ author: String, text: String, at: { type: Date, default: () => new Date() } }],
      doneAt: Date,
      // lifecycle tasks (made by the CRM): which step, of which company / deal
      step: { type: String, default: null, index: true },
      company: { type: id, ref: 'Company', index: true },
      deal: { type: id, ref: 'Deal', index: true },
    },
    { timestamps: true }
  )
);

// Weekly report: written text and/or files. One per employee per week (week = its Monday).
const reportSchema = new Schema(
  {
    user: { type: id, ref: 'User', required: true, index: true },
    week: { type: String, required: true }, // Monday of the week, YYYY-MM-DD
    text: { type: String, default: '' },
    files: [file],
    adminNote: { type: String, default: '' },
  },
  { timestamps: true }
);
reportSchema.index({ user: 1, week: 1 }, { unique: true });
export const WeeklyReport = model('WeeklyReport', reportSchema);

// Monthly target set by the admin: a checklist (employee ticks what is done) + optional files.
export const Target = model(
  'Target',
  new Schema(
    {
      user: { type: id, ref: 'User', required: true, index: true },
      month: { type: String, required: true }, // YYYY-MM
      title: { type: String, default: '' },
      items: [{ text: String, done: { type: Boolean, default: false }, doneAt: Date }],
      files: [file],
      note: { type: String, default: '' },
    },
    { timestamps: true }
  )
);

// Employee documents (contract, ID proof, offer letter ...): a file or a link (e.g. Google Drive)
export const HrDocument = model(
  'HrDocument',
  new Schema(
    {
      user: { type: id, ref: 'User', required: true, index: true },
      name: { type: String, required: true },
      category: { type: String, default: 'Other' },
      file,
      link: { type: String, default: '' },
      uploadedBy: String,
    },
    { timestamps: true }
  )
);

// Salary slip for one month (a snapshot: later salary changes don't change old slips)
const payslipSchema = new Schema(
  {
    user: { type: id, ref: 'User', required: true, index: true },
    month: { type: String, required: true }, // YYYY-MM
    name: String,
    code: String,
    designation: String,
    department: String,
    bank: String,
    pan: String,
    daysInMonth: Number,
    workingDays: Number, // days in month minus Sundays and holidays
    paidDays: Number,
    unpaidDays: Number, // absent + unpaid leave
    present: Number,
    paidLeave: Number,
    basic: Number,
    hra: Number,
    allowances: Number,
    gross: Number,
    lossOfPay: Number,
    pt: Number,
    tds: Number,
    otherDeductions: Number,
    totalDeductions: Number,
    net: Number,
    status: { type: String, enum: ['draft', 'final', 'paid'], default: 'draft' },
    paidOn: String,
  },
  { timestamps: true }
);
payslipSchema.index({ user: 1, month: 1 }, { unique: true });
export const Payslip = model('Payslip', payslipSchema);
