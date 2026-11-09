/**
 * Selection-bounded edit is not wired.
 * Cloud runs already forward selectedIds. Local plan.revise still edits the named
 * item on the whole floor. A silent filter would drop a named move when the
 * selection and the name disagree, so this stays a stub.
 */
export function selectionBoundedReviseAvailable(): false {
  return false;
}
