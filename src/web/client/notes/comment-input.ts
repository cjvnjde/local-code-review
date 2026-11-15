import type { ReviewComment } from "../../../shared/review-types.ts";

/** Send reviewer fields only; saved notes also carry server-owned conversation metadata. */
export function commentInput({
  id,
  file,
  body,
  triage,
  start,
  end,
  label,
  side,
  code,
  scope,
  ca,
  cb,
  snippet,
  image,
  web,
}: ReviewComment): ReviewComment {
  return {
    id,
    file,
    body,
    triage,
    start,
    end,
    label,
    side,
    code,
    scope,
    ca,
    cb,
    snippet,
    image,
    web,
  };
}
