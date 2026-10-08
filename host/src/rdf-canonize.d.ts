declare module "rdf-canonize" {
  export function canonize(
    dataset: readonly object[],
    options: { readonly algorithm: "RDFC-1.0" },
  ): Promise<string>;
}
