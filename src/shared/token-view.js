const TOKEN_TYPE_PATTERN = /^[a-z][a-z0-9-]*$/;

export function tokenClassName(tokenType, prefix = "numr-token-") {
	return TOKEN_TYPE_PATTERN.test(tokenType || "")
		? `${prefix}${tokenType}`
		: `${prefix}text`;
}

export function tokenizeForDisplay(session, text, variableNames = "") {
	if (!text) return [];
	const tokens = session?.tokenizeLine(text, variableNames) || [];
	return tokens.length ? tokens : [{ text, token_type: "text" }];
}

export function appendTokenNodes(
	parent,
	session,
	text,
	variableNames = "",
	prefix = "numr-token-",
) {
	for (const token of tokenizeForDisplay(session, text, variableNames)) {
		if (token.token_type === "whitespace") {
			parent.append(document.createTextNode(token.text));
			continue;
		}

		const span = document.createElement("span");
		span.className = tokenClassName(token.token_type, prefix);
		span.textContent = token.text;
		parent.append(span);
	}
	return parent;
}

export function renderTokenTotals(
	parent,
	session,
	totals,
	labelClass = "total-label",
) {
	parent.replaceChildren();
	if (!totals.length) return parent;

	const label = document.createElement("span");
	label.className = labelClass;
	label.textContent = "total:";
	parent.append(label);
	for (const total of totals) {
		parent.append(document.createTextNode("  "));
		appendTokenNodes(parent, session, total);
	}
	return parent;
}

export function tokenRanges(session, text, variableNames = "") {
	const ranges = [];
	let offset = 0;

	for (const token of tokenizeForDisplay(session, text, variableNames)) {
		const from = offset;
		offset += token.text.length;
		if (token.token_type !== "whitespace" && offset > from) {
			ranges.push({
				from,
				to: offset,
				className: tokenClassName(token.token_type),
			});
		}
	}

	return ranges;
}
