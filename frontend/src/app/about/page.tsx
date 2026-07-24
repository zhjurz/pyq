import { getApiUrl } from "@/lib/api-fetch";
import AboutClient from "./AboutClient";

export default async function AboutPage() {
  const API_URL = getApiUrl();
  let content = "";
  try {
    const res = await fetch(`${API_URL}/settings`, { next: { revalidate: 60 } });
    const data = await res.json();
    content = data.aboutContent || "";
  } catch {
    content = "";
  }

  return <AboutClient initialContent={content} />;
}
