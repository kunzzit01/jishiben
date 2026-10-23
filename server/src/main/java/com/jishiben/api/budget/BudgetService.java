package com.jishiben.api.budget;

import com.jishiben.api.common.ApiException;
import com.jishiben.api.common.Money;
import com.jishiben.api.common.Texts;
import com.jishiben.api.profile.ProfileService;
import com.jishiben.api.resolve.RefMaps;
import com.jishiben.api.resolve.ReferenceResolver;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Budgets are keyed by (scope, category, currency). The app identifies the overall budget with the
 * literal string 'total', which the chk_budgets_scope constraint forbids as a category id, so it is
 * translated to scope='total' AND category_id IS NULL on the way in.
 */
@Service
public class BudgetService {

    static final String SCOPE_TOTAL = "total";
    static final String SCOPE_CATEGORY = "category";

    private final BudgetRepository budgets;
    private final ReferenceResolver references;
    private final ProfileService profiles;

    public BudgetService(BudgetRepository budgets, ReferenceResolver references, ProfileService profiles) {
        this.budgets = budgets;
        this.references = references;
        this.profiles = profiles;
    }

    @Transactional(readOnly = true)
    public List<BudgetDtos.Response> list(long ownerId, String currency) {
        String clean = Texts.trimToNull(currency);
        List<Budget> rows = clean == null
                ? budgets.findByOwnerIdOrderByScopeAscCategoryIdAsc(ownerId)
                : budgets.findByOwnerIdAndCurrencyOrderByScopeAscCategoryIdAsc(ownerId,
                        Texts.upperCurrency(clean, "currency"));
        RefMaps maps = references.loadMaps(ownerId);
        return rows.stream().map(row -> toResponse(row, maps)).toList();
    }

    @Transactional
    public BudgetDtos.Response upsert(long ownerId, BudgetDtos.UpsertRequest request) {
        String rawCategory = Texts.trimToNull(request.categoryUid());
        boolean total = rawCategory == null || SCOPE_TOTAL.equalsIgnoreCase(rawCategory);
        Long categoryId = total ? null : references.optionalCategory(ownerId, rawCategory);
        String currency = Texts.trimToNull(request.currency()) == null
                ? profiles.currency(ownerId)
                : Texts.upperCurrency(request.currency(), "currency");
        if (request.amount().signum() == 0) {
            throw ApiException.validation(
                    "A zero budget is not stored; delete the budget instead (DELETE /api/budgets/{clientUid})");
        }
        String clientUid = Texts.trimToNull(request.clientUid());
        if (clientUid != null) {
            Texts.limit(clientUid, 64, "clientUid");
        } else {
            clientUid = (total ? SCOPE_TOTAL : rawCategory) + "|" + currency;
        }
        Budget row = findExisting(ownerId, total, categoryId, currency, clientUid);
        if (row == null) {
            row = new Budget();
            row.setOwnerId(ownerId);
        }
        row.setClientUid(clientUid);
        row.setScope(total ? SCOPE_TOTAL : SCOPE_CATEGORY);
        row.setCategoryId(categoryId);
        row.setCurrency(currency);
        row.setAmount(Money.requireAmount(request.amount(), "amount"));
        Budget saved = budgets.save(row);
        return toResponse(saved, references.loadMaps(ownerId));
    }

    @Transactional
    public void delete(long ownerId, String clientUid) {
        String uid = Texts.requireNonBlank(clientUid, "clientUid");
        Budget row = budgets.findByOwnerIdAndClientUid(ownerId, uid)
                .orElseThrow(() -> ApiException.notFound("Budget not found: " + uid));
        budgets.delete(row);
    }

    /**
     * The business key wins over client_uid: the app derives client_uid from the same two values, and
     * uk_budgets_user_scope_category_currency is the real uniqueness rule.
     */
    private Budget findExisting(long ownerId, boolean total, Long categoryId, String currency, String clientUid) {
        Budget byKey = total
                ? budgets.findByOwnerIdAndScopeAndCurrencyAndCategoryIdIsNull(ownerId, SCOPE_TOTAL, currency)
                        .orElse(null)
                : budgets.findByOwnerIdAndScopeAndCurrencyAndCategoryId(ownerId, SCOPE_CATEGORY, currency,
                                categoryId)
                        .orElse(null);
        if (byKey != null) {
            return byKey;
        }
        return budgets.findByOwnerIdAndClientUid(ownerId, clientUid).orElse(null);
    }

    private static BudgetDtos.Response toResponse(Budget row, RefMaps maps) {
        return new BudgetDtos.Response(
                row.getClientUid(),
                row.getScope(),
                maps.category(row.getCategoryId()),
                row.getCurrency(),
                row.getAmount(),
                row.getCreatedAt(),
                row.getUpdatedAt());
    }
}
