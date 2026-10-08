import { redirect } from "next/navigation";

/** The entry point is the signed-in area; its guard sends visitors to /login. */
export default function RootPage() {
  redirect("/app");
}
