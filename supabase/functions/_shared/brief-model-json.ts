/** Accept a complete JSON reply or one enclosing Markdown code block, never surrounding prose. */
export function parseBriefModelJson(content:string):unknown {
  const trimmed=content.trim();
  const fenced=/^```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n```[\t ]*$/i.exec(trimmed);
  try{return JSON.parse(fenced?fenced[1]!:trimmed) as unknown;}
  catch{throw new SyntaxError('Invalid model JSON');}
}
