/**
 * Tools are pure transformations over data: decoding a texture, parsing a
 * movie, encoding an image. A tool knows nothing about archives, uris or the
 * editor, which is what makes it reusable and testable without an extension
 * host. Anything that has to fetch an entry or render something is a format.
 */

/**
 * The handle a running tool, a format or a command uses to reach tools.
 * Deliberately narrower than `ToolRegistry`: what is handed out can run a
 * tool, but not register one.
 */
export interface ToolBox {
  /**
   * Reaches another tool. Resolved when it is called rather than when it is
   * registered, so two tools may use each other and the order they are
   * registered in does not matter.
   */
  use<Input, Output>(tool: Tool<Input, Output>): (input: Input) => Promise<Output>;
}

/**
 * A contribution that transforms data under an id. An implementor supplies the
 * id and `run`, and `run` must be a function of its input alone — no archive,
 * no uri, no editor. `Input` and `Output` belong to the tool: the registry
 * stores every tool as `Tool<never, unknown>` and only a caller naming the
 * tool it wants sees the real types.
 */
export interface Tool<Input, Output> {
  /** Stable across releases: it identifies the tool in settings and logs */
  readonly id: string;
  /** Transforms one input. Another tool is reached through `tools`, never by importing it */
  run(input: Input, tools: ToolBox): Promise<Output> | Output;
}

/**
 * The tools a session knows about, and the box that runs them. `extension.ts`
 * holds a single instance for the life of the session; it starts empty, and a
 * tool that was never registered still runs when a caller passes it to `use`.
 */
export interface ToolRegistry extends ToolBox {
  /** Adds tools. Ids must be unique across all of them: registering one twice throws */
  register(...tools: Tool<never, unknown>[]): void;
  /** Finds the tool registered under an id, if any */
  get(id: string): Tool<never, unknown> | undefined;
  /** Lists every registered tool, in registration order */
  all(): readonly Tool<never, unknown>[];
}

/**
 * Creates the tool registry `extension.ts` holds for the life of the session.
 */
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
