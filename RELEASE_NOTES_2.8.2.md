# KeyFlow Next 2.8.2 — Dahl + OpenRouter recovery + visible mistakes

## AI

- Dedicated Dahl Inference provider (`https://inference.dahl.global/v1`), with public live `/models` discovery and authenticated `/chat/completions`.
- Does not hard-code potentially retired Dahl model identifiers; MiniMax M2.7 is ranked highly *if* it is currently returned.
- Dahl requests omit router-specific reasoning controls and sampling arguments. The AI key lives in the same native credential store as other providers.
- Clear 401, 402, and unsupported-model diagnostic messages. **A Dahl welcome balance in the account pool is not enough; allocate tokens to your key at `/account`.**
- OpenRouter: visible-empty, `finish_reason=length` recoveries use reduced reasoning and additional output budget once, then switch model. Existing per-provider failover remains bounded.
- Model testing uses a short output budget; a successful models listing is not claimed to prove generation works.

## Typing

- Mistakes now show **Pressed X ≠ Expected Y**, including Persian graphemes, regular spaces, half-spaces, Enter and Tab.
- Underlying incorrect target character remains marked in red. This new readout displays the *actual incorrect key* too.
- Dismissible, accessible status element. Uses `textContent` to handle arbitrary keystrokes safely; does not do synchronous text reflow on every keystroke.

## Verification & limits

- Automated tests cover Dahl live catalog, exact request structure, API errors, OpenRouter fallback, and mistake events and labels.
- Live authenticated Dahl/OpenRouter use and native Linux credential-store/AppImage compilation must be validated on your machine with your account and toolchain.
