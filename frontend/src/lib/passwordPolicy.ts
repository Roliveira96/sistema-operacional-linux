// Client-side mirror of the password policy (SPEC-003 RN-14) for live
// feedback. The server remains the authority.

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

export type PolicyViolation = "TOO_SHORT" | "TOO_LONG" | "EQUALS_EMAIL" | "EQUALS_ACADEMIC_ID" | "SAME_AS_CURRENT";

export function checkPassword(password: string, context: { email?: string; current?: string } = {}): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const length = Array.from(password).length;
  if (length < MIN_PASSWORD_LENGTH) violations.push("TOO_SHORT");
  if (length > MAX_PASSWORD_LENGTH) violations.push("TOO_LONG");
  if (context.email && password.toLowerCase() === context.email.toLowerCase()) violations.push("EQUALS_EMAIL");
  if (context.current && password === context.current) violations.push("SAME_AS_CURRENT");
  return violations;
}
