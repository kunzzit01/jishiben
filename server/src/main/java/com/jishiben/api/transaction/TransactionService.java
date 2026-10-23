package com.jishiben.api.transaction;

import com.jishiben.api.asset.Asset;
import com.jishiben.api.asset.AssetRepository;
import com.jishiben.api.common.ApiException;
import com.jishiben.api.common.Checks;
import com.jishiben.api.common.Money;
import com.jishiben.api.common.PageResponse;
import com.jishiben.api.common.Texts;
import com.jishiben.api.profile.ProfileService;
import com.jishiben.api.resolve.RefMaps;
import com.jishiben.api.resolve.ReferenceResolver;
import java.math.BigDecimal;
import java.math.RoundingMode;
import jakarta.persistence.criteria.Predicate;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Transactions: expense, income, and transfer (a currency exchange is just a transfer that carries a
 * rate). amount is always the outgoing side; convertedAmount is what arrives in the destination.
 */
@Service
public class TransactionService {

    static final Set<String> TYPES = Set.of("expense", "income", "transfer");
    private static final int MAX_PAGE_SIZE = 100;

    private final TransactionRepository transactions;
    private final AssetRepository assets;
    private final ReferenceResolver references;
    private final ProfileService profiles;

    public TransactionService(TransactionRepository transactions, AssetRepository assets,
                              ReferenceResolver references, ProfileService profiles) {
        this.transactions = transactions;
        this.assets = assets;
        this.references = references;
        this.profiles = profiles;
    }

    @Transactional(readOnly = true)
    public PageResponse<TransactionDtos.Response> list(long ownerId, String ledgerUid, String categoryUid,
                                                       String assetUid, String type, LocalDate from, LocalDate to,
                                                       int page, int size) {
        if (from != null && to != null && from.isAfter(to)) {
            throw ApiException.validation("from must not be after to");
        }
        int safeSize = size <= 0 ? 50 : Math.min(size, MAX_PAGE_SIZE);
        Pageable pageable = PageRequest.of(Math.max(page, 0), safeSize,
                Sort.by(Sort.Order.desc("occurredOn"), Sort.Order.desc("id")));
        Long ledgerId = references.optionalLedger(ownerId, ledgerUid);
        Long categoryId = references.optionalCategory(ownerId, categoryUid);
        Long assetId = references.optionalAsset(ownerId, assetUid);
        String cleanType = Checks.optionalOneOf(type, TYPES, "type");
        Page<Transaction> result = transactions.findAll(
                filter(ownerId, ledgerId, categoryId, assetId, cleanType, from, to), pageable);
        RefMaps maps = references.loadMaps(ownerId);
        return PageResponse.of(result.map(row -> toResponse(row, maps)));
    }

    /** Every filter is optional except the account id, which always comes from the token. */
    private static Specification<Transaction> filter(long ownerId, Long ledgerId, Long categoryId, Long assetId,
                                                     String type, LocalDate from, LocalDate to) {
        return (root, query, builder) -> {
            List<Predicate> predicates = new ArrayList<>();
            predicates.add(builder.equal(root.get("ownerId"), ownerId));
            if (ledgerId != null) {
                predicates.add(builder.equal(root.get("ledgerId"), ledgerId));
            }
            if (categoryId != null) {
                predicates.add(builder.equal(root.get("categoryId"), categoryId));
            }
            if (type != null) {
                predicates.add(builder.equal(root.get("type"), type));
            }
            if (from != null) {
                predicates.add(builder.greaterThanOrEqualTo(root.get("occurredOn"), from));
            }
            if (to != null) {
                predicates.add(builder.lessThanOrEqualTo(root.get("occurredOn"), to));
            }
            if (assetId != null) {
                predicates.add(builder.or(
                        builder.equal(root.get("assetId"), assetId),
                        builder.equal(root.get("fromAssetId"), assetId),
                        builder.equal(root.get("toAssetId"), assetId)));
            }
            return builder.and(predicates.toArray(new Predicate[0]));
        };
    }

    @Transactional(readOnly = true)
    public TransactionDtos.Response get(long ownerId, String clientUid) {
        return toResponse(require(ownerId, clientUid), references.loadMaps(ownerId));
    }

    @Transactional
    public TransactionDtos.Response upsert(long ownerId, TransactionDtos.UpsertRequest request) {
        String uid = Texts.requireNonBlank(request.clientUid(), "clientUid");
        Texts.limit(uid, 64, "clientUid");
        Transaction row = transactions.findByOwnerIdAndClientUid(ownerId, uid).orElse(null);
        if (row == null) {
            row = new Transaction();
            row.setOwnerId(ownerId);
            row.setClientUid(uid);
        }
        row.setLedgerId(references.requiredLedger(ownerId, request.ledgerUid()));
        row.setCategoryId(references.optionalCategory(ownerId, request.categoryUid()));
        row.setAssetId(references.optionalAsset(ownerId, request.assetUid()));
        row.setFromAssetId(references.optionalAsset(ownerId, request.fromAssetUid()));
        row.setToAssetId(references.optionalAsset(ownerId, request.toAssetUid()));
        row.setType(Checks.oneOf(request.type(), TYPES, "type"));
        row.setAmount(Money.requireAmount(request.amount(), "amount"));
        String currency = Texts.trimToNull(request.currency());
        row.setCurrency(currency == null ? null : Texts.upperCurrency(currency, "currency"));
        row.setExchangeRate(Money.scaleRate(request.exchangeRate()));
        row.setConvertedAmount(Money.optionalAmount(request.convertedAmount(), "convertedAmount"));
        row.setFee(Money.optionalAmount(request.fee(), "fee"));
        row.setOccurredOn(requireDate(request.occurredOn()));
        row.setNote(note(request.note()));
        row.setDisplayName(Texts.trimToNull(request.displayName()));
        row.setReceiptPath(Texts.trimToNull(request.receiptPath()));
        normalise(ownerId, row);
        return toResponse(transactions.save(row), references.loadMaps(ownerId));
    }

    @Transactional
    public TransactionDtos.Response patch(long ownerId, String clientUid, TransactionDtos.PatchRequest request) {
        Transaction row = require(ownerId, clientUid);
        if (request.ledgerUid() != null) {
            row.setLedgerId(references.requiredLedger(ownerId, request.ledgerUid()));
        }
        if (request.categoryUid() != null) {
            row.setCategoryId(references.optionalCategory(ownerId, request.categoryUid()));
        }
        if (request.assetUid() != null) {
            row.setAssetId(references.optionalAsset(ownerId, request.assetUid()));
        }
        if (request.fromAssetUid() != null) {
            row.setFromAssetId(references.optionalAsset(ownerId, request.fromAssetUid()));
        }
        if (request.toAssetUid() != null) {
            row.setToAssetId(references.optionalAsset(ownerId, request.toAssetUid()));
        }
        if (request.type() != null) {
            row.setType(Checks.oneOf(request.type(), TYPES, "type"));
        }
        if (request.amount() != null) {
            row.setAmount(Money.requireAmount(request.amount(), "amount"));
        }
        if (request.currency() != null) {
            String currency = Texts.trimToNull(request.currency());
            row.setCurrency(currency == null ? null : Texts.upperCurrency(currency, "currency"));
        }
        if (request.exchangeRate() != null) {
            row.setExchangeRate(Money.scaleRate(request.exchangeRate()));
        }
        if (request.convertedAmount() != null) {
            row.setConvertedAmount(Money.optionalAmount(request.convertedAmount(), "convertedAmount"));
        }
        if (request.fee() != null) {
            row.setFee(Money.optionalAmount(request.fee(), "fee"));
        }
        if (request.occurredOn() != null) {
            row.setOccurredOn(request.occurredOn());
        }
        if (request.note() != null) {
            row.setNote(note(request.note()));
        }
        if (request.displayName() != null) {
            row.setDisplayName(Texts.trimToNull(request.displayName()));
        }
        if (request.receiptPath() != null) {
            row.setReceiptPath(Texts.trimToNull(request.receiptPath()));
        }
        normalise(ownerId, row);
        return toResponse(transactions.save(row), references.loadMaps(ownerId));
    }

    @Transactional
    public void delete(long ownerId, String clientUid) {
        transactions.delete(require(ownerId, clientUid));
    }

    /**
     * One place for the invariants of each type:
     * a transfer owns from/to and may carry a rate; an expense/income owns at most one account and
     * must not carry a rate or a fee. A rate without an explicit converted amount derives it, using
     * the same formula the app uses (amount x rate).
     *
     * <p>assetId is optional for expense/income on purpose: the app books the fee of a transfer as
     * its own expense <em>without</em> an account, so the balance is only charged once (inside the
     * transfer). Such a row still counts in the currency report, but it belongs to no account, so it
     * contributes to no account balance — exactly what the app's own getAssetBalance does.
     */
    private void normalise(long ownerId, Transaction row) {
        switch (row.getType()) {
            case "transfer" -> {
                row.setAssetId(null);
                if (row.getFromAssetId() == null || row.getToAssetId() == null) {
                    throw ApiException.validation("A transfer requires fromAssetUid and toAssetUid");
                }
                if (row.getFromAssetId().equals(row.getToAssetId())) {
                    throw ApiException.validation("A transfer needs two different accounts");
                }
                if (row.getExchangeRate() != null && row.getConvertedAmount() == null) {
                    row.setConvertedAmount(row.getAmount()
                            .multiply(row.getExchangeRate())
                            .setScale(Money.SCALE, RoundingMode.HALF_UP));
                }
                if (row.getConvertedAmount() != null && row.getExchangeRate() == null
                        && row.getAmount().signum() != 0) {
                    row.setExchangeRate(row.getConvertedAmount()
                            .divide(row.getAmount(), Money.RATE_SCALE, RoundingMode.HALF_UP));
                }
            }
            default -> {
                row.setFromAssetId(null);
                row.setToAssetId(null);
                row.setExchangeRate(null);
                row.setConvertedAmount(null);
                row.setFee(null);
            }
        }
        if (Texts.trimToNull(row.getCurrency()) == null) {
            row.setCurrency(primaryCurrency(ownerId, row));
        }
    }

    /** Snapshot of the amount's currency: the account's own currency, else the account-level default. */
    private String primaryCurrency(long ownerId, Transaction row) {
        Long sourceId = "transfer".equals(row.getType()) ? row.getFromAssetId() : row.getAssetId();
        if (sourceId != null) {
            Asset asset = assets.findById(sourceId).orElse(null);
            if (asset != null && asset.getOwnerId() != null && asset.getOwnerId() == ownerId) {
                return asset.getCurrency();
            }
        }
        return profiles.currency(ownerId);
    }

    private static LocalDate requireDate(LocalDate value) {
        if (value == null) {
            throw ApiException.validation("occurredOn is required");
        }
        return value;
    }

    private static String note(String value) {
        String clean = Texts.trimToNull(value);
        if (clean == null) {
            return "";
        }
        return Texts.limit(clean, 500, "note");
    }

    private Transaction require(long ownerId, String clientUid) {
        String uid = Texts.requireNonBlank(clientUid, "clientUid");
        return transactions.findByOwnerIdAndClientUid(ownerId, uid)
                .orElseThrow(() -> ApiException.notFound("Transaction not found: " + uid));
    }

    static TransactionDtos.Response toResponse(Transaction row, RefMaps maps) {
        return new TransactionDtos.Response(
                row.getClientUid(),
                maps.ledger(row.getLedgerId()),
                maps.category(row.getCategoryId()),
                maps.asset(row.getAssetId()),
                maps.asset(row.getFromAssetId()),
                maps.asset(row.getToAssetId()),
                row.getType(),
                row.getAmount(),
                row.getCurrency(),
                row.getExchangeRate(),
                row.getConvertedAmount(),
                row.getFee(),
                row.getOccurredOn(),
                row.getNote(),
                row.getDisplayName(),
                row.getReceiptPath(),
                row.getCreatedAt(),
                row.getUpdatedAt());
    }
}
