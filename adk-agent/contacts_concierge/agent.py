"""
Contacts Concierge — a Google ADK multi-agent system over the Just Contacts MCP server.

Architecture (the whitepaper's "factory model": an orchestrator that delegates to
specialists, each with a narrow toolset):

    root: Concierge (orchestrator, gemini-2.5-flash)
      ├── capture_agent  → MCP tool: add_contact
      ├── finder_agent   → MCP tools: search_contacts, list_contacts, get_contact
      └── memory_agent   → MCP tools: get_contact, ask_about_contact

Every tool comes from ONE place — our `just-contacts` MCP server (mcp-server/server.ts),
which the agents spawn over stdio via ADK's McpToolset. The agents own no business logic;
they reason and route, the MCP server (reusing the production Genkit pipeline) does the work.

Two whitepaper concepts are deliberately applied:
- Tool access via MCP (model- and vendor-agnostic), and cross-specialist delegation.
- Intelligent model routing: the orchestrator runs on `flash` (better routing judgement),
  the specialists on the cheaper `flash-lite` — peak quality where it matters, low token cost
  everywhere else.

Run from `adk-agent/`:
    adk web                 # local web playground (English entry point for judges)
    adk run contacts_concierge
"""
import os
import platform
from pathlib import Path

from dotenv import load_dotenv
from google.adk.agents import LlmAgent
from google.adk.tools.mcp_tool import McpToolset, StdioConnectionParams
from mcp import StdioServerParameters

# ── Locate the repo root and load the single shared .env ─────────────────────
# agent.py = <repo>/adk-agent/contacts_concierge/agent.py  →  repo root is 2 up.
REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(REPO_ROOT / ".env")  # GOOGLE_API_KEY, MCP_USER_ID, FIREBASE_SERVICE_ACCOUNT_KEY
load_dotenv(Path(__file__).resolve().parent / ".env")  # optional per-agent overrides

# On Windows, npx is a .cmd shim and must be invoked by its full name.
NPX = "npx.cmd" if platform.system() == "Windows" else "npx"

ORCHESTRATOR_MODEL = os.getenv("ADK_ORCHESTRATOR_MODEL", "gemini-2.5-flash")
SPECIALIST_MODEL = os.getenv("ADK_SPECIALIST_MODEL", "gemini-2.5-flash-lite")


def mcp_tools(tool_filter: list[str]) -> McpToolset:
    """
    Build an McpToolset that launches our Just Contacts MCP server over stdio and
    exposes only the given tools to a specialist (least-privilege per agent).

    The child process inherits the current environment (PATH so `npx` resolves, plus
    GEMINI/Firebase/MCP_USER_ID); the server also self-loads the repo-root .env.
    """
    return McpToolset(
        connection_params=StdioConnectionParams(
            server_params=StdioServerParameters(
                command=NPX,
                args=["tsx", "mcp-server/server.ts"],
                cwd=str(REPO_ROOT),
                env={**os.environ},
            ),
            timeout=60.0,
        ),
        tool_filter=tool_filter,
    )


# ── Specialists ──────────────────────────────────────────────────────────────
capture_agent = LlmAgent(
    name="capture_agent",
    model=SPECIALIST_MODEL,
    description="Saves a NEW person to the user's contacts from a free-form description.",
    instruction=(
        "You add new contacts. Call `add_contact` with the user's raw description "
        "(name, company, where you met, phone, interests — whatever they said). "
        "Then confirm what was saved (name, role, tags). If the tool reports a duplicate, "
        "tell the user the person already exists. Do not invent details the user didn't give."
    ),
    tools=[mcp_tools(["add_contact"])],
)

finder_agent = LlmAgent(
    name="finder_agent",
    model=SPECIALIST_MODEL,
    description="Finds EXISTING contacts by meaning, lists them, or opens one full profile.",
    instruction=(
        "You find people the user already saved. For fuzzy descriptions "
        "('the designer I had lunch with', 'who likes mountains') call `search_contacts`. "
        "To browse, call `list_contacts`. To open one person's full card, call `get_contact` "
        "with their id. Present results as a short, readable list (name — role)."
    ),
    tools=[mcp_tools(["search_contacts", "list_contacts", "get_contact"])],
)

memory_agent = LlmAgent(
    name="memory_agent",
    model=SPECIALIST_MODEL,
    description="Answers questions ABOUT one already-identified person (their dossier/history).",
    instruction=(
        "You answer questions about a specific known contact ('where did we meet?', "
        "'what did I promise to send?'). If you don't have the contact id yet, first use "
        "`get_contact` (or ask the finder) to load it, then call `ask_about_contact`. "
        "Answer only from stored data; if it's not there, say so honestly."
    ),
    tools=[mcp_tools(["get_contact", "ask_about_contact"])],
)

# ── Orchestrator (root) ──────────────────────────────────────────────────────
root_agent = LlmAgent(
    name="contacts_concierge",
    model=ORCHESTRATOR_MODEL,
    description="Personal contacts concierge: a second memory for the people you meet.",
    instruction=(
        "You are Just Contacts — a friendly concierge that helps the user remember people. "
        "Route each request to the right specialist:\n"
        "- Adding/saving a NEW person → capture_agent.\n"
        "- Finding, listing, or opening EXISTING people → finder_agent.\n"
        "- A question ABOUT a specific person → memory_agent.\n"
        "Delegate rather than answering from your own memory — the specialists hold the tools. "
        "Keep replies short and warm. Reply in the user's language."
    ),
    sub_agents=[capture_agent, finder_agent, memory_agent],
)
