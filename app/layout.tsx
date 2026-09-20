export const metadata = {
  title: "Research-to-Deck Generator",
  description: "RAG over academic papers, synthesized into a branded, cited PPTX deck.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>{children}</body>
    </html>
  );
}
