package com.jishiben.api.common;

/**
 * Small string helpers. Their whole purpose is the app's magic-value normalisation:
 * the React Native client sends '' (empty string) for "no category" and 'total' for "all categories",
 * and those must never reach the database as-is.
 */
public final class Texts {

    private Texts() {
    }

    /** Trims, and maps blank to null, so empty-string ids become SQL NULL instead of a bogus FK. */
    public static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    public static String requireNonBlank(String value, String field) {
        String trimmed = trimToNull(value);
        if (trimmed == null) {
            throw ApiException.validation(field + " must not be blank");
        }
        return trimmed;
    }

    public static String limit(String value, int max, String field) {
        if (value != null && value.length() > max) {
            throw ApiException.validation(field + " must be at most " + max + " characters");
        }
        return value;
    }

    public static String upperCurrency(String value, String field) {
        String raw = trimToNull(value);
        if (raw == null) {
            throw ApiException.validation(field + " must be a 3-letter ISO-4217 currency code");
        }
        String upper = raw.toUpperCase(java.util.Locale.ROOT);
        if (upper.length() != 3 || !upper.chars().allMatch(Character::isLetter)) {
            throw ApiException.validation(field + " must be a 3-letter ISO-4217 currency code");
        }
        return upper;
    }
}
