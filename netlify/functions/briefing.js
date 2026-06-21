exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY_BM;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'API key not configured' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { practitionerName, sessionCount, carryOver, onPlate, avoiding, energy } = body;

  if (!practitionerName || !onPlate) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required fields' })
    };
  }

  const energyMap = {
    steady: 'steady — feeling good going in',
    managing: 'managing — it\'s a mixed week',
    low: 'low — running on less than usual'
  };

  const systemPrompt = `You are a weekly briefing assistant for Gilt & Grace. You help practitioners get clear on their week before it starts.

The practitioner's name is ${practitionerName}.
They have ${sessionCount || 0} client sessions this week.
Energy level going in: ${energyMap[energy] || 'not specified'}.

From their inputs, generate a weekly practice briefing with four sections.

IMPORTANT TONE: Direct, warm, honest. Not motivational. Not coaching-speak. Like a smart colleague who sees clearly and tells the truth. Never use: "transformative" / "empower" / "capacity" / "hold space" / "journey" / "circle back" / "touch base" / "level up" / "game-changer". No bullet points with dashes in the glance section — write it as prose. The other three sections use clean short lines, one per item.

Generate exactly this JSON structure. No preamble. No markdown fences. Just JSON:

{
  "glance": "2-3 sentences. A clear-eyed picture of what this week actually holds. Honest about the load. Accounts for session count, what's on the plate, and energy. Not a pep talk — a picture.",
  "protect": ["item 1", "item 2", "item 3"],
  "letgo": ["item 1", "item 2"],
  "signal": "One honest observation about what this week is telling them. Not advice. Not a directive. An observation. Could be about load, about avoidance, about a pattern. Specific to their inputs — not generic."
}

For "protect": identify 2-4 things that matter and will get sacrificed if not named explicitly. These are not sessions — sessions are already in the calendar. These are the non-session things with real weight.

For "letgo": identify 1-3 things that are not happening this week. Name them clearly so they stop taking up mental space. Be direct — "this is not a this-week thing" energy.

For "signal": this is the most important output. Read between the lines of what they've shared — especially the avoiding field if present. Say the thing they probably already know but haven't said out loud. Keep it to 2 sentences maximum. Specific, not generic.

If the avoiding field is empty, work with what you have. Don't mention the absence of it.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Practitioner: ${practitionerName}
Sessions this week: ${sessionCount || 0}
What didn't get done last week: ${carryOver || 'nothing noted'}
What's on the plate this week: ${onPlate}
What they're avoiding: ${avoiding || 'not specified'}
Energy going in: ${energyMap[energy] || 'not specified'}`
          }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Upstream API error', detail: err })
      };
    }

    const data = await response.json();
    const raw = data.content && data.content[0] && data.content[0].text;

    if (!raw) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Empty response from API' })
      };
    }

    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch(e) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Could not parse response', raw: cleaned.slice(0, 200) })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    };

  } catch(e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Function error', detail: e.message })
    };
  }
};
