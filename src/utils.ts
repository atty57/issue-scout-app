export const languageNames: Record<string, string> = {
  python: "Python",
  typescript: "TypeScript",
  javascript: "JavaScript",
  csharp: "C#",
  c: "C",
  none: "Language independent",
};
export function safeHttps(value: string): string | undefined {
  if (!value.startsWith("https://")) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function dateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
export function relativeDate(value: string) {
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 86400000),
  );
  return days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}
export function fileError(file: File): string | undefined {
  if (file.size > 5 * 1024 * 1024)
    return "Choose a resume that is 5 MB or smaller.";
  const ext = file.name.toLowerCase().split(".").pop();
  const mimes: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  if (!ext || !mimes[ext] || (file.type && file.type !== mimes[ext]))
    return "Choose a PDF or DOCX resume.";
}
