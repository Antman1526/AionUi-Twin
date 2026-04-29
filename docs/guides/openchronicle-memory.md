# OpenChronicle Memory

AionUi can register OpenChronicle as a managed MCP memory server on macOS.

OpenChronicle runs locally and exposes its MCP endpoint at:

```text
http://127.0.0.1:8742/mcp
```

On macOS, AionUi creates a disabled managed MCP entry named **OpenChronicle Memory**. Turn it on from **Settings > Tools > MCP**, test the connection, then sync it to compatible agents.

## Windows 11

OpenChronicle capture is currently macOS-focused. Windows 11 remains compatible with AionUi because the managed OpenChronicle MCP entry is only auto-created on macOS. If OpenChronicle later provides a Windows server on the same endpoint, the MCP entry can be added manually with:

```json
{
  "mcpServers": {
    "OpenChronicle Memory": {
      "type": "streamable_http",
      "url": "http://127.0.0.1:8742/mcp"
    }
  }
}
```

## Runtime Notes

- Keep OpenChronicle running before testing the MCP connection.
- The MCP server is local-only at `127.0.0.1`.
- AionUi does not copy OpenChronicle's SQLite or Markdown memory files; it accesses memory through MCP.
