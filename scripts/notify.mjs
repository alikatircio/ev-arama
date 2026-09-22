export async function notify(topic, { title, message, url }) {
  if (!topic) return;
  try {
    await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: {
        Title: encodeRfc2047(title),
        ...(url ? { Click: url } : {}),
      },
      body: message,
    });
  } catch (err) {
    console.error('ntfy gönderilemedi:', err.message);
  }
}

// ntfy header values must be ASCII; non-ASCII titles (Turkish/German chars) need RFC 2047 encoding.
function encodeRfc2047(text) {
  if (/^[\x00-\x7F]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf-8').toString('base64')}?=`;
}
