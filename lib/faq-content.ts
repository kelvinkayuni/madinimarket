export type FaqItem = {
  question: string;
  answer: string;
};

export type FaqGroup = {
  title: string;
  items: FaqItem[];
};

export function parseFaqContent(content: string): FaqGroup[] {
  const groups: FaqGroup[] = [];
  let currentGroup: FaqGroup | null = null;
  let currentQuestion: FaqItem | null = null;

  const finishQuestion = () => {
    if (!currentQuestion) return;
    currentQuestion.answer = currentQuestion.answer.trim();
    if (!currentQuestion.answer) {
      throw new Error(`Add an answer for "${currentQuestion.question}".`);
    }
    currentQuestion = null;
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("## ")) {
      finishQuestion();
      const title = line.slice(3).trim();
      if (!title) throw new Error("Give each FAQ section a title after ##.");
      currentGroup = { title, items: [] };
      groups.push(currentGroup);
      continue;
    }

    if (line.startsWith("### ")) {
      finishQuestion();
      if (!currentGroup) throw new Error("Add a ## section title before each FAQ question.");
      const question = line.slice(4).trim();
      if (!question) throw new Error("Add a question after ###.");
      currentQuestion = { question, answer: "" };
      currentGroup.items.push(currentQuestion);
      continue;
    }

    if (line.startsWith("#")) {
      throw new Error("Use ## for section titles and ### for FAQ questions.");
    }
    if (!currentQuestion) {
      throw new Error("Add each answer below its ### question heading.");
    }
    currentQuestion.answer += `${currentQuestion.answer ? "\n" : ""}${line}`;
  }

  finishQuestion();
  if (!groups.length || groups.some((group) => group.items.length === 0)) {
    throw new Error("Add at least one FAQ question under every ## section.");
  }
  return groups;
}
