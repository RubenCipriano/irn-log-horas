namespace TimeFlow.Ai.Contract;

// Provider-neutral chat message. Roles map 1:1 onto every provider we
// support (Anthropic, OpenAI, Ollama). `system` lives on the request
// envelope (not as a Role here) because Anthropic models it as a
// top-level field, OpenAI as a role — easier to normalise on the way
// out than on the way in.
public enum AiRole { User, Assistant }

public sealed record AiMessage(AiRole Role, string Content);
