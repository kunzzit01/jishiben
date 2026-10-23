package com.jishiben.api.common;

import java.util.Set;
import java.util.regex.Pattern;

/** Field-level guards shared by every service: enumerations, colours, and small integers. */
public final class Checks {

    private static final Pattern HEX_COLOR = Pattern.compile("^#[0-9a-fA-F]{6}$");

    private Checks() {
    }

    /** '#RRGGBB' or null. Rejects values the CHAR(7) column could not hold meaningfully. */
    public static String color(String value) {
        String clean = Texts.trimToNull(value);
        if (clean == null) {
            return null;
        }
        if (!HEX_COLOR.matcher(clean).matches()) {
            throw ApiException.validation("color must look like #RRGGBB");
        }
        return clean;
    }

    public static String oneOf(String value, Set<String> allowed, String field) {
        String clean = Texts.requireNonBlank(value, field);
        if (!allowed.contains(clean)) {
            throw ApiException.validation(field + " must be one of " + allowed);
        }
        return clean;
    }

    public static String optionalOneOf(String value, Set<String> allowed, String field) {
        String clean = Texts.trimToNull(value);
        if (clean == null) {
            return null;
        }
        return oneOf(clean, allowed, field);
    }

    /** Maps a nullable bounded int onto the TINYINT UNSIGNED columns (days, months, decimals). */
    public static Short small(Integer value, int min, int max, String field) {
        if (value == null) {
            return null;
        }
        if (value < min || value > max) {
            throw ApiException.validation(field + " must be between " + min + " and " + max);
        }
        return value.shortValue();
    }

    public static Integer unbox(Short value) {
        return value == null ? null : value.intValue();
    }
}
