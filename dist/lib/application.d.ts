import { VariantDict } from "./protocol";
export interface Application {
    identifier: string;
    name: string;
    pid: number;
    parameters: VariantDict;
}
