/**
 * Tools: pure transformations over data.
 *
 * A tool knows nothing about archives, URIs or the editor, which is what
 * makes it reusable and testable without an extension host. Decoding a
 * texture, parsing a movie, encoding an image are all tools. Anything that
 * has to fetch an entry or render something is a format instead.
 */

export interface ToolBox {
  /**
   * Reaches another tool. Resolved when it is called rather than when it is
   * registered, so two tools may use each other and the order they are
   * registered in does not matter.
   */
  use<Input, Output>(tool: Tool<Input, Output>): (input: Input) => Promise<Output>;
}

export interface Tool<Input, Output> {
  /** Stable across releases: it identifies the tool in settings and logs */
  readonly id: string;
  run(input: Input, tools: ToolBox): Promise<Output> | Output;
}

export interface ToolRegistry extends ToolBox {
  register(...tools: Tool<never, unknown>[]): void;
  get(id: string): Tool<never, unknown> | undefined;
  all(): readonly Tool<never, unknown>[];
}

export const createToolRegistry = (): ToolRegistry => {
  const tools = new Map<string, Tool<never, unknown>>();

  const registry: ToolRegistry = {
    register(...added) {
      for (const tool of added) {
        if (tools.has(tool.id)) {
          throw new Error(`A tool is already registered as '${tool.id}'`);
        }

        tools.set(tool.id, tool);
      }
    },

    get: (id) => tools.get(id),

    all: () => Array.from(tools.values()),

    use<Input, Output>(tool: Tool<Input, Output>) {
      return async (input: Input) => {
        const registered = tools.get(tool.id) as Tool<Input, Output> | undefined;

        // Running the registered instance rather than the one passed in lets
        // a tool be replaced without every caller learning about it
        return (registered ?? tool).run(input, registry);
      };
    },
  };

  return registry;
};
