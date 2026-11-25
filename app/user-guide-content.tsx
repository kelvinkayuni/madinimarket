type GuideBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

function parseGuide(content: string): GuideBlock[] {
  const blocks: GuideBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: "list", items: list });
    list = [];
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      continue;
    }

    const item = /^[-*]\s+(.+)$/.exec(line);
    if (item) {
      flushParagraph();
      list.push(item[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

function renderInline(text: string, blockIndex: number) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={`${blockIndex}-${index}`}>{part.slice(2, -2)}</strong>
      : part,
  );
}

function slug(text: string) {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default function UserGuideContent({ content }: { content: string }) {
  return <div className="user-guide-markdown">
    {parseGuide(content).map((block, index) => {
      if (block.type === "heading") {
        const id = `${block.level}-${slug(block.text)}`;
        if (block.level === 1) return <h2 id={id} key={index}>{renderInline(block.text, index)}</h2>;
        if (block.level === 2) return <h3 id={id} key={index}>{renderInline(block.text, index)}</h3>;
        return <h4 id={id} key={index}>{renderInline(block.text, index)}</h4>;
      }
      if (block.type === "list") {
        return <ul key={index}>{block.items.map((item, itemIndex) =>
          <li key={`${index}-${itemIndex}`}>{renderInline(item, index * 100 + itemIndex)}</li>,
        )}</ul>;
      }
      return <p key={index}>{renderInline(block.text, index)}</p>;
    })}
  </div>;
}
