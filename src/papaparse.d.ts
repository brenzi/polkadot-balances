declare module "papaparse" {
  interface ParseResult<T> {
    data: T[];
    errors: any[];
    meta: any;
  }
  interface ParseConfig {
    header?: boolean;
    [key: string]: any;
  }
  function parse<T = any>(input: string, config?: ParseConfig): ParseResult<T>;
  function unparse(data: any, config?: any): string;
  export default { parse, unparse };
}
