export function escapeHtml(text) {
	if (!text) return "";
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderTokens(session, text, variableNames = "", classPrefix = "token-") {
	if (!text || !session) return escapeHtml(text);
	const tokens = session.tokenizeLine(text, variableNames);
	if (!tokens.length) return escapeHtml(text);
	return tokens
		.map((token) =>
			token.token_type === "whitespace"
				? escapeHtml(token.text)
				: `<span class="${classPrefix}${token.token_type}">${escapeHtml(token.text)}</span>`,
		)
		.join("");
}

export function replaceHtml(element, html) {
	const range = document.createRange();
	range.selectNodeContents(element);
	element.replaceChildren(range.createContextualFragment(html));
}
