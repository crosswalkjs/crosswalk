import { registryFromCatalog } from "@crosswalkjs/core";

// Your server's operators, as the editor needs them. Here a stand-in server
// answers; in your app this is your API.
export async function loadRegistry() {
  const response = await fetch("/crosswalk/operators");
  if (!response.ok) throw new Error(`Couldn't load the operators (${response.status})`);
  return registryFromCatalog(await response.json());
}
