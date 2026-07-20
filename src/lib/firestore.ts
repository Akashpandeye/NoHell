/**
 * @deprecated This name remains temporarily for source compatibility.
 * Application persistence is server-only; use db-mappers for pure row mapping
 * and server-firestore for authenticated server repositories.
 */
export {
  rowToBookmark,
  rowToNote,
  rowToSession,
  rowToUserProfile,
  sessionToRow,
} from "@/lib/db-mappers";
