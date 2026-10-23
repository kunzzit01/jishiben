package com.jishiben.api.resolve;

import java.util.Map;

/**
 * Internal id → client_uid maps for one account. Responses speak client_uid only, so database ids
 * never leave the server (they would also invite cross-account id guessing).
 */
public record RefMaps(Map<Long, String> ledgers, Map<Long, String> categories, Map<Long, String> assets) {

    public String ledger(Long id) {
        return id == null ? null : ledgers.get(id);
    }

    public String category(Long id) {
        return id == null ? null : categories.get(id);
    }

    public String asset(Long id) {
        return id == null ? null : assets.get(id);
    }
}
