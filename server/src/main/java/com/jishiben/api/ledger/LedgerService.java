package com.jishiben.api.ledger;

import com.jishiben.api.asset.AssetRepository;
import com.jishiben.api.common.ApiException;
import com.jishiben.api.common.Checks;
import com.jishiben.api.common.Texts;
import com.jishiben.api.paymentplan.PaymentPlanRepository;
import com.jishiben.api.transaction.TransactionRepository;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LedgerService {

    private final LedgerRepository ledgers;
    private final AssetRepository assets;
    private final TransactionRepository transactions;
    private final PaymentPlanRepository paymentPlans;

    public LedgerService(LedgerRepository ledgers, AssetRepository assets, TransactionRepository transactions,
                         PaymentPlanRepository paymentPlans) {
        this.ledgers = ledgers;
        this.assets = assets;
        this.transactions = transactions;
        this.paymentPlans = paymentPlans;
    }

    @Transactional(readOnly = true)
    public List<LedgerDtos.Response> list(long ownerId, boolean includeArchived) {
        List<Ledger> rows = includeArchived
                ? ledgers.findByOwnerIdOrderBySortOrderAscIdAsc(ownerId)
                : ledgers.findByOwnerIdAndArchivedAtIsNullOrderBySortOrderAscIdAsc(ownerId);
        return rows.stream().map(LedgerService::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public LedgerDtos.Response get(long ownerId, String clientUid) {
        return toResponse(require(ownerId, clientUid));
    }

    @Transactional
    public LedgerDtos.Response upsert(long ownerId, LedgerDtos.UpsertRequest request) {
        String uid = Texts.requireNonBlank(request.clientUid(), "clientUid");
        Texts.limit(uid, 64, "clientUid");
        Ledger ledger = ledgers.findByOwnerIdAndClientUid(ownerId, uid).orElse(null);
        boolean creating = ledger == null;
        if (creating) {
            ledger = new Ledger();
            ledger.setOwnerId(ownerId);
            ledger.setClientUid(uid);
        }
        ledger.setName(Texts.requireNonBlank(request.name(), "name"));
        ledger.setIcon(Texts.requireNonBlank(request.icon(), "icon"));
        ledger.setColor(Checks.color(request.color()));
        ledger.setSortOrder(request.sortOrder() == null ? 0 : request.sortOrder());
        applyDefault(ownerId, ledger, request.defaultLedger());
        applyArchived(ledger, request.archived());
        return toResponse(ledgers.save(ledger));
    }

    @Transactional
    public LedgerDtos.Response patch(long ownerId, String clientUid, LedgerDtos.PatchRequest request) {
        Ledger ledger = require(ownerId, clientUid);
        if (request.name() != null) {
            ledger.setName(Texts.requireNonBlank(request.name(), "name"));
        }
        if (request.icon() != null) {
            ledger.setIcon(Texts.requireNonBlank(request.icon(), "icon"));
        }
        if (request.color() != null) {
            ledger.setColor(Checks.color(request.color()));
        }
        if (request.sortOrder() != null) {
            ledger.setSortOrder(request.sortOrder());
        }
        applyDefault(ownerId, ledger, request.defaultLedger());
        applyArchived(ledger, request.archived());
        return toResponse(ledgers.save(ledger));
    }

    /**
     * ledgers is referenced by assets, transactions and payment_plans with ON DELETE RESTRICT, so a
     * ledger that still holds data can only be removed with force=true, and then only in dependency
     * order inside one transaction.
     *
     * <p>The default flag is not a deletion barrier: any ledger, including the one currently marked
     * default, can be deleted. Re-creating a ledger after the list is emptied is the client's job;
     * this API only ever removes rows.
     */
    @Transactional
    public LedgerDtos.DeleteResult delete(long ownerId, String clientUid, boolean force) {
        Ledger ledger = require(ownerId, clientUid);
        long assetCount = assets.countByOwnerIdAndLedgerId(ownerId, ledger.getId());
        long transactionCount = transactions.countByOwnerIdAndLedgerId(ownerId, ledger.getId());
        long planCount = paymentPlans.countByOwnerIdAndLedgerId(ownerId, ledger.getId());
        if (!force && (assetCount + transactionCount + planCount) > 0) {
            throw ApiException.conflict("Ledger still holds data (transactions=" + transactionCount
                    + ", paymentPlans=" + planCount + ", assets=" + assetCount
                    + "); repeat with ?force=true to delete the ledger and everything in it");
        }
        int deletedTransactions = transactions.deleteAllByLedger(ownerId, ledger.getId());
        int deletedPlans = paymentPlans.deleteAllByLedger(ownerId, ledger.getId());
        int deletedAssets = assets.deleteAllByLedger(ownerId, ledger.getId());
        ledgers.delete(ledger);
        return new LedgerDtos.DeleteResult(ledger.getClientUid(), true, deletedTransactions, deletedPlans,
                deletedAssets);
    }

    private void applyDefault(long ownerId, Ledger ledger, Boolean makeDefault) {
        if (makeDefault == null) {
            return;
        }
        ledger.setDefaultLedger(makeDefault);
        if (!makeDefault) {
            return;
        }
        ledgers.findByOwnerIdOrderBySortOrderAscIdAsc(ownerId).stream()
                .filter(other -> !other.getClientUid().equals(ledger.getClientUid()))
                .filter(Ledger::isDefaultLedger)
                .forEach(other -> {
                    other.setDefaultLedger(false);
                    ledgers.save(other);
                });
    }

    private static void applyArchived(Ledger ledger, Boolean archived) {
        if (archived == null) {
            return;
        }
        ledger.setArchivedAt(archived ? Instant.now() : null);
    }

    private Ledger require(long ownerId, String clientUid) {
        String uid = Texts.requireNonBlank(clientUid, "clientUid");
        return ledgers.findByOwnerIdAndClientUid(ownerId, uid)
                .orElseThrow(() -> ApiException.notFound("Ledger not found: " + uid));
    }

    static LedgerDtos.Response toResponse(Ledger ledger) {
        return new LedgerDtos.Response(
                ledger.getClientUid(),
                ledger.getName(),
                ledger.getIcon(),
                ledger.getColor(),
                ledger.getSortOrder(),
                ledger.isDefaultLedger(),
                ledger.getArchivedAt() != null,
                ledger.getArchivedAt(),
                ledger.getCreatedAt(),
                ledger.getUpdatedAt());
    }
}
