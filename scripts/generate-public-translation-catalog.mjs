import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "app", "marketplace.tsx");
const outputPath = path.join(root, "lib", "public-translation-catalog.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const phrases = new Set();

function addPhrase(value) {
  const phrase = value.replace(/\s+/g, " ").trim();
  if (phrase && phrase.length <= 120 && /\p{L}/u.test(phrase)) phrases.add(phrase);
}

function findPublicRoot(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sourceFile) === "main") {
    const className = node.openingElement.attributes.properties.find((attribute) =>
      ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === "className");
    if (className?.initializer?.getText(sourceFile).includes("market-shell")) return node;
  }

  let result;
  ts.forEachChild(node, (child) => {
    result ??= findPublicRoot(child);
  });
  return result;
}

function visitExpression(node) {
  if (!node) return;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    addPhrase(node.text);
    return;
  }
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
    visitJsx(node);
    return;
  }
  if (ts.isTemplateExpression(node)) return;
  if (ts.isConditionalExpression(node)) {
    visitExpression(node.whenTrue);
    visitExpression(node.whenFalse);
    return;
  }
  if (ts.isBinaryExpression(node) &&
      [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
    visitExpression(node.right);
    return;
  }
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
    visitExpression(node.expression);
    return;
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    if (ts.isBlock(node.body)) visitStatements(node.body.statements);
    else visitExpression(node.body);
    return;
  }
  if (ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["map", "flatMap"].includes(node.expression.name.text)) {
    for (const argument of node.arguments) visitExpression(argument);
  }
}

function visitStatements(statements) {
  for (const statement of statements) {
    if (ts.isReturnStatement(statement)) visitExpression(statement.expression);
    else if (ts.isBlock(statement)) visitStatements(statement.statements);
    else if (ts.isIfStatement(statement)) {
      visitStatements([statement.thenStatement]);
      if (statement.elseStatement) visitStatements([statement.elseStatement]);
    }
  }
}

function addPlaceholder(element) {
  const placeholder = element.attributes.properties.find((attribute) =>
    ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === "placeholder");
  if (!placeholder || !ts.isJsxAttribute(placeholder)) return;

  if (placeholder.initializer && ts.isStringLiteral(placeholder.initializer)) {
    addPhrase(placeholder.initializer.text);
  } else if (placeholder.initializer && ts.isJsxExpression(placeholder.initializer)) {
    visitExpression(placeholder.initializer.expression);
  }
}

function isNoTranslate(element) {
  return element.attributes.properties.some((attribute) =>
    ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === "data-no-translate");
}

function visitJsx(node) {
  if (ts.isJsxElement(node)) {
    if (isNoTranslate(node.openingElement)) return;
    addPlaceholder(node.openingElement);
    for (const child of node.children) visitJsx(child);
    return;
  }
  if (ts.isJsxSelfClosingElement(node)) {
    addPlaceholder(node);
    return;
  }
  if (ts.isJsxFragment(node)) {
    for (const child of node.children) visitJsx(child);
    return;
  }
  if (ts.isJsxText(node)) {
    addPhrase(node.text);
    return;
  }
  if (ts.isJsxExpression(node)) visitExpression(node.expression);
}

const publicRoot = findPublicRoot(sourceFile);
if (!publicRoot) throw new Error("Could not locate the public marketplace interface.");
visitJsx(publicRoot);

const output = `export const publicTranslationPhrases = ${JSON.stringify([...phrases].sort(), null, 2)} as const;\n`;
fs.writeFileSync(outputPath, output);
console.log(`Generated ${phrases.size} public interface phrases.`);
