import { describe, expect, it } from "vitest";
import { UnsPath, isPathSegment } from "../src/index";

describe("UnsPath", () => {
    it("parses a UNS id and gives its broker resource path", () => {
        const path = UnsPath.parse("uns://site1/line1/motor01/speed");
        expect(path.segments).toEqual(["site1", "line1", "motor01", "speed"]);
        expect(path.id).toBe("uns://site1/line1/motor01/speed");
        expect(path.resourcePath).toBe("/site1/line1/motor01/speed");
    });

    it("normalizes a trailing slash away", () => {
        expect(UnsPath.parse("uns://site1/line1/").id).toBe("uns://site1/line1");
    });

    it.each(["site1/line1", "uns://", "uns://site1//line1", "uns://site1/../x", "uns://site1/-x", "uns://site 1", 42])("refuses %j", (id) => {
        expect(() => UnsPath.parse(id as string)).toThrow();
        expect(UnsPath.tryParse(id as string)).toBeUndefined();
    });

    it("contains itself and its descendants, by whole segments", () => {
        const root = UnsPath.parse("uns://site1/line1");
        expect(root.contains(UnsPath.parse("uns://site1/line1"))).toBe(true);
        expect(root.contains(UnsPath.parse("uns://site1/line1/motor01"))).toBe(true);
        expect(root.contains(UnsPath.parse("uns://site1/line10"))).toBe(false);
        expect(root.contains(UnsPath.parse("uns://site1"))).toBe(false);
    });

    it("builds descendants, and refuses an invalid segment", () => {
        expect(UnsPath.parse("uns://site1/line1").child("motor01", "speed").id).toBe("uns://site1/line1/motor01/speed");
        expect(() => UnsPath.parse("uns://site1").child("a/../b")).toThrow();
    });

    it("checks segments the way the broker checks path segments", () => {
        expect(isPathSegment("motor-01_a.b")).toBe(true);
        for (const bad of ["", ".", "..", "_x", "a/b", "a b"]) expect(isPathSegment(bad)).toBe(false);
    });
});
