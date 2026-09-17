import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(500);
const emailSchema = z.string().trim().min(3).max(320).email().refine(
  (value) => !/[\r\n]/.test(value),
  'Gmail email addresses must not contain line breaks.',
);
const recipientListSchema = z.array(emailSchema).min(1).max(25);
const optionalRecipientListSchema = z.array(emailSchema).max(25).optional();
const subjectSchema = z.string().trim().min(1).max(500).refine(
  (value) => !/[\r\n]/.test(value),
  'Gmail subjects must not contain CR/LF characters.',
);
const bodySchema = z.string().min(1).max(200_000);
const labelNameSchema = z.string().trim().min(1).max(500).refine(
  (value) => !/[\r\n\u0000]/.test(value),
  'Gmail label names must not contain line breaks or NUL characters.',
);
const rfcMessageIdSchema = z.string().trim().min(3).max(1_000).regex(
  /^<[^<>\r\n]+>$/,
  'Gmail reply message IDs must be RFC-style Message-ID values enclosed in angle brackets.',
);
const referencesSchema = z.array(rfcMessageIdSchema).max(20).optional();

export const gmailOrganizeActionSchema = z.enum([
  'archive',
  'moveToInbox',
  'markRead',
  'markUnread',
  'markSpam',
  'markNotSpam',
  'star',
  'unstar',
  'applyLabel',
  'removeLabel',
]);
export type GmailOrganizeAction = z.infer<typeof gmailOrganizeActionSchema>;

function requireLabelOnlyForLabelActions(
  value: { readonly action: GmailOrganizeAction; readonly labelId?: string },
  context: z.RefinementCtx,
): void {
  const usesUserLabel = value.action === 'applyLabel' || value.action === 'removeLabel';
  if (usesUserLabel && value.labelId === undefined) {
    context.addIssue({ code: 'custom', path: ['labelId'], message: `${value.action} requires a Gmail USER label id.` });
  }
  if (!usesUserLabel && value.labelId !== undefined) {
    context.addIssue({ code: 'custom', path: ['labelId'], message: `labelId is only valid with applyLabel or removeLabel.` });
  }
}

const modifyMessageSchema = z.object({
  messageId: idSchema,
  action: gmailOrganizeActionSchema,
  labelId: idSchema.optional(),
}).strict().superRefine(requireLabelOnlyForLabelActions);

const modifyThreadSchema = z.object({
  threadId: idSchema,
  action: gmailOrganizeActionSchema,
  labelId: idSchema.optional(),
}).strict().superRefine(requireLabelOnlyForLabelActions);

export const gmailToolArgumentSchemas = {
  'gmail.modifyMessage': modifyMessageSchema,
  'gmail.modifyThread': modifyThreadSchema,
  'gmail.trashMessage': z.object({ messageId: idSchema }).strict(),
  'gmail.untrashMessage': z.object({ messageId: idSchema }).strict(),
  'gmail.trashThread': z.object({ threadId: idSchema }).strict(),
  'gmail.untrashThread': z.object({ threadId: idSchema }).strict(),
  'gmail.createLabel': z.object({ name: labelNameSchema }).strict(),
  'gmail.updateLabel': z.object({ labelId: idSchema, name: labelNameSchema }).strict(),
  'gmail.deleteLabel': z.object({ labelId: idSchema }).strict(),
  'gmail.sendMessage': z.object({
    to: recipientListSchema,
    cc: optionalRecipientListSchema,
    subject: subjectSchema,
    body: bodySchema,
  }).strict().superRefine((value, context) => {
    if (value.to.length + (value.cc?.length ?? 0) > 50) {
      context.addIssue({ code: 'custom', path: ['cc'], message: 'Gmail sends are limited to 50 total To + Cc recipients by Elara.' });
    }
  }),
  'gmail.replyMessage': z.object({
    threadId: idSchema,
    to: emailSchema,
    subject: subjectSchema,
    body: bodySchema,
    inReplyTo: rfcMessageIdSchema,
    references: referencesSchema,
  }).strict(),
} as const;

export type GmailToolName = keyof typeof gmailToolArgumentSchemas;
export type GmailToolArguments<T extends GmailToolName> = z.infer<(typeof gmailToolArgumentSchemas)[T]>;

export function validateGmailToolArguments<T extends GmailToolName>(tool: T, value: unknown): GmailToolArguments<T> {
  return gmailToolArgumentSchemas[tool].parse(value) as GmailToolArguments<T>;
}
