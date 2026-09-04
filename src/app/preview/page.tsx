import { notFound } from "next/navigation";
import { PreviewHarness } from "./PreviewHarness";

/**
 * Dev-only visual harness. Mounts the real shell and views against fixture data
 * so the UI can be reviewed (and screenshotted) without a Google sign-in.
 * Returns 404 in any non-development build, so it never ships.
 */
export default function PreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PreviewHarness />;
}
