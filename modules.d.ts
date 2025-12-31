// Module declarations for virtual imports used in the build.
declare module "*.css" {
    const content: string;
    export default content;
}

declare module "virtual:i18n-catalogues" {
    const catalogues: Record<string, Record<string, string>>;
    export default catalogues;
}
