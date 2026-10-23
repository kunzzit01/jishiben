package com.jishiben.api.resolve;

import com.jishiben.api.asset.AssetRepository;
import com.jishiben.api.category.CategoryRepository;
import com.jishiben.api.common.ApiException;
import com.jishiben.api.common.Texts;
import com.jishiben.api.ledger.LedgerRepository;
import java.util.HashMap;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * Translates the client's string ids into database ids, always scoped to the authenticated account.
 * An id belonging to somebody else is indistinguishable from an id that does not exist.
 */
@Component
public class ReferenceResolver {

    private final LedgerRepository ledgers;
    private final CategoryRepository categories;
    private final AssetRepository assets;

    public ReferenceResolver(LedgerRepository ledgers, CategoryRepository categories, AssetRepository assets) {
        this.ledgers = ledgers;
        this.categories = categories;
        this.assets = assets;
    }

    public Long requiredLedger(long ownerId, String uid) {
        Long id = optionalLedger(ownerId, uid);
        if (id == null) {
            throw ApiException.validation("ledgerUid is required");
        }
        return id;
    }

    public Long optionalLedger(long ownerId, String uid) {
        String clean = Texts.trimToNull(uid);
        if (clean == null) {
            return null;
        }
        return ledgers.findByOwnerIdAndClientUid(ownerId, clean)
                .map(ledger -> ledger.getId())
                .orElseThrow(() -> ApiException.validation(
                        "ledgerUid does not reference one of your ledgers: " + clean));
    }

    /** The app's '' means "no category"; that must become SQL NULL, never a foreign key value. */
    public Long optionalCategory(long ownerId, String uid) {
        String clean = Texts.trimToNull(uid);
        if (clean == null) {
            return null;
        }
        if ("total".equalsIgnoreCase(clean)) {
            throw ApiException.validation("categoryUid 'total' is only valid for budgets; use scope=total there");
        }
        return categories.findByOwnerIdAndClientUid(ownerId, clean)
                .map(category -> category.getId())
                .orElseThrow(() -> ApiException.validation(
                        "categoryUid does not reference one of your categories: " + clean));
    }

    public Long optionalAsset(long ownerId, String uid) {
        String clean = Texts.trimToNull(uid);
        if (clean == null) {
            return null;
        }
        return assets.findByOwnerIdAndClientUid(ownerId, clean)
                .map(asset -> asset.getId())
                .orElseThrow(() -> ApiException.validation(
                        "assetUid does not reference one of your assets: " + clean));
    }

    public RefMaps loadMaps(long ownerId) {
        Map<Long, String> ledgerMap = new HashMap<>();
        ledgers.findByOwnerIdOrderBySortOrderAscIdAsc(ownerId)
                .forEach(ledger -> ledgerMap.put(ledger.getId(), ledger.getClientUid()));
        Map<Long, String> categoryMap = new HashMap<>();
        categories.findByOwnerIdOrderBySortOrderAscIdAsc(ownerId)
                .forEach(category -> categoryMap.put(category.getId(), category.getClientUid()));
        Map<Long, String> assetMap = new HashMap<>();
        assets.findByOwnerIdOrderBySortOrderAscIdAsc(ownerId)
                .forEach(asset -> assetMap.put(asset.getId(), asset.getClientUid()));
        return new RefMaps(ledgerMap, categoryMap, assetMap);
    }
}
