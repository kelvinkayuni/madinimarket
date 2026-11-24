import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoots = [path.join(root, "app"), path.join(root, "lib")];
const outputPath = path.join(root, "lib", "interface-translation-catalog.ts");
const translatableAttributes = new Set(["alt", "aria-description", "aria-label", "placeholder", "title"]);
const messageCallNames = new Set(["onError", "onMessage", "onNotice", "setError", "setMessage", "setNotice"]);
const maxPhraseLength = 1000;
const phrases = new Set();
let sourceFile;

function listSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const currentPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return entry.name.startsWith(".") || entry.name === "node_modules" ? [] : listSourceFiles(currentPath);
      }
      if (!entry.isFile() || !/\.(?:[cm]?[jt]sx?)$/i.test(entry.name) ||
        /\.d\.[cm]?ts$/i.test(entry.name) || /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(entry.name) ||
        currentPath === outputPath) return [];
      return [currentPath];
    });
}

function addPhrase(value) {
  const phrase = value.replace(/\s+/g, " ").trim();
  const staticText = phrase.replace(/\{\{value\d+\}\}/g, "").trim();
  if (staticText && phrase.length <= maxPhraseLength && /\p{L}/u.test(staticText)) phrases.add(phrase);
}

function getPropertyName(name) {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : "";
}

function addTemplatePhrase(node) {
  let phrase = node.head.text;
  for (const [index, span] of node.templateSpans.entries()) {
    phrase += `{{value${index + 1}}}${span.literal.text}`;
  }
  addPhrase(phrase);
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
  if (ts.isTemplateExpression(node)) {
    addTemplatePhrase(node);
    return;
  }
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
    visitSourceNode(node.body);
    return;
  }
  if (ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["map", "flatMap"].includes(node.expression.name.text)) {
    for (const argument of node.arguments) visitSourceNode(argument);
  }
}

function isNoTranslate(element) {
  return element.attributes.properties.some((attribute) =>
    ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === "data-no-translate");
}

function visitTranslatableAttributes(element) {
  for (const attribute of element.attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || !translatableAttributes.has(attribute.name.getText(sourceFile))) continue;
    if (attribute.initializer && ts.isStringLiteral(attribute.initializer)) {
      addPhrase(attribute.initializer.text);
    } else if (attribute.initializer && ts.isJsxExpression(attribute.initializer)) {
      visitExpression(attribute.initializer.expression);
    }
  }
}

function visitJsxAttributeExpressions(element) {
  for (const attribute of element.attributes.properties) {
    if (ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer)) {
      visitSourceNode(attribute.initializer.expression);
    }
  }
}

function visitJsx(node) {
  if (ts.isJsxElement(node)) {
    if (isNoTranslate(node.openingElement)) return;
    visitTranslatableAttributes(node.openingElement);
    for (const child of node.children) {
      if (ts.isJsxText(child)) addPhrase(child.text);
      else if (ts.isJsxExpression(child)) visitExpression(child.expression);
      else visitJsx(child);
    }
    return;
  }
  if (ts.isJsxSelfClosingElement(node)) {
    if (!isNoTranslate(node)) visitTranslatableAttributes(node);
    return;
  }
  if (ts.isJsxFragment(node)) {
    for (const child of node.children) {
      if (ts.isJsxText(child)) addPhrase(child.text);
      else if (ts.isJsxExpression(child)) visitExpression(child.expression);
      else visitJsx(child);
    }
  }
}

function visitApiResponseMessages(node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) ||
    node.expression.name.text !== "json") return;
  const responseName = node.expression.expression.getText(sourceFile);
  if (responseName !== "NextResponse" && responseName !== "Response") return;
  const payload = node.arguments[0];
  if (!payload || !ts.isObjectLiteralExpression(payload)) return;
  for (const property of payload.properties) {
    if (!ts.isPropertyAssignment(property) || !["error", "message"].includes(getPropertyName(property.name))) continue;
    visitExpression(property.initializer);
  }
}

function visitSourceNode(node) {
  if (!node) return;
  if (ts.isJsxElement(node)) {
    const excluded = isNoTranslate(node.openingElement);
    visitJsx(node);
    if (!excluded) visitJsxAttributeExpressions(node.openingElement);
    return;
  }
  if (ts.isJsxSelfClosingElement(node)) {
    const excluded = isNoTranslate(node);
    visitJsx(node);
    if (!excluded) visitJsxAttributeExpressions(node);
    return;
  }
  if (ts.isJsxFragment(node)) {
    visitJsx(node);
    return;
  }
  if (ts.isCallExpression(node)) {
    const callName = ts.isIdentifier(node.expression)
      ? node.expression.text
      : ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : "";
    if (messageCallNames.has(callName)) {
      for (const argument of node.arguments) visitExpression(argument);
    }
    visitApiResponseMessages(node);
  }
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Error") {
    visitExpression(node.arguments?.[0]);
  }
  ts.forEachChild(node, visitSourceNode);
}

const sourcePaths = sourceRoots.flatMap((sourceRoot) => listSourceFiles(sourceRoot));
for (const sourcePath of sourcePaths) {
  const source = fs.readFileSync(sourcePath, "utf8");
  const isJsx = /\.(?:tsx|jsx)$/i.test(sourcePath);
  sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    isJsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  visitSourceNode(sourceFile);
}

const output = `export const interfaceTranslationPhrases = ${JSON.stringify([...phrases].sort(), null, 2)} as const;\n`;
fs.writeFileSync(outputPath, output);
console.log(`Generated ${phrases.size} interface phrases from ${sourcePaths.length} source files.`);
