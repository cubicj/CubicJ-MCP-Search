export interface Config {
  braveApiKey: string | undefined;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const key = env.BRAVE_API_KEY?.trim();
  return { braveApiKey: key ? key : undefined };
}
