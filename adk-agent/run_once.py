"""
One-shot end-to-end check of the ADK multi-agent: sends a single message to the
Concierge orchestrator and prints the final reply. Verifies the whole loop —
orchestrator → specialist delegation → MCP tool call → Gemini → Firestore.

Run from adk-agent/:  python run_once.py "your message"
"""
import asyncio
import sys
import warnings

warnings.filterwarnings("ignore")

from google.adk.runners import InMemoryRunner
from google.genai import types

from contacts_concierge.agent import root_agent

QUERY = sys.argv[1] if len(sys.argv) > 1 else "Who works in design?"


async def main():
    runner = InMemoryRunner(agent=root_agent, app_name="just-contacts")
    session = await runner.session_service.create_session(
        app_name="just-contacts", user_id="tester"
    )
    message = types.Content(role="user", parts=[types.Part(text=QUERY)])

    final_text = ""
    tools_called = []
    async for event in runner.run_async(
        user_id="tester", session_id=session.id, new_message=message
    ):
        if event.content and event.content.parts:
            for part in event.content.parts:
                if getattr(part, "function_call", None):
                    tools_called.append(part.function_call.name)
                if getattr(part, "text", None):
                    final_text = part.text

    print(f"\nQUERY:  {QUERY}")
    print(f"TOOLS:  {tools_called or '(none)'}")
    print(f"REPLY:  {final_text}\n")


if __name__ == "__main__":
    asyncio.run(main())
