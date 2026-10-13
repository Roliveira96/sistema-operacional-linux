import { redirect } from "next/navigation";

/** The members of a class now live on the students tab of the class page (SPEC-041 D-07). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/app/classes/${id}?tab=students`);
}
