"""LLM configuration for the campaign platform."""

import logging

from databricks_langchain import ChatDatabricks

from agent_server.config import LLM_ENDPOINT

logger = logging.getLogger(__name__)


class _SanitizedChatDatabricks(ChatDatabricks):
    """Strips extra fields (e.g. 'id') from tool message content blocks
    that some LLM APIs reject."""

    @staticmethod
    def _strip_content_ids(messages):
        for msg in messages:
            if isinstance(msg.content, list):
                msg.content = [
                    {k: v for k, v in block.items() if k != "id"}
                    if isinstance(block, dict) else block
                    for block in msg.content
                ]
        return messages

    def _stream(self, messages, *args, **kwargs):
        return super()._stream(self._strip_content_ids(messages), *args, **kwargs)

    async def _astream(self, messages, *args, **kwargs):
        async for chunk in super()._astream(self._strip_content_ids(messages), *args, **kwargs):
            yield chunk


def get_llm(endpoint: str | None = None):
    """Return a sanitized ChatDatabricks LLM instance.

    Args:
        endpoint: Model serving endpoint name. Defaults to LLM_ENDPOINT.
    """
    return _SanitizedChatDatabricks(endpoint=endpoint or LLM_ENDPOINT)
