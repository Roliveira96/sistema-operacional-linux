import { redirect } from "next/navigation";

/**
 * The old address of the list of assessments (SPEC-082 D-02): the list is the tab Avaliações of the page of the class, and the pages of an
 * assessment still live under this path. The server sends whoever comes here, from a link or a bookmark, to the tab.
 */
export default async function AssessmentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/app/classes/${id}?tab=assessments`);
}
