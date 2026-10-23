package com.jishiben.api.asset;

import com.jishiben.api.common.ApiException;
import com.jishiben.api.common.Checks;
import com.jishiben.api.common.Money;
import com.jishiben.api.common.Texts;
import com.jishiben.api.ledger.Ledger;
import com.jishiben.api.ledger.LedgerRepository;
import com.jishiben.api.resolve.RefMaps;
import com.jishiben.api.resolve.ReferenceResolver;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AssetService {

    static final Set<String> TYPES = Set.of("cash", "bank", "credit", "ewallet", "investment", "other");

    private final AssetRepository assets;
    private final LedgerRepository ledgers;
    private final ReferenceResolver references;

    public AssetService(AssetRepository assets, LedgerRepository ledgers, ReferenceResolver references) {
        this.assets = assets;
        this.ledgers = ledgers;
        this.references = references;
    }

    @Transactional(readOnly = true)
    public List<AssetDtos.Response> list(long ownerId, String ledgerUid, boolean includeArchived) {
        String uid = Texts.trimToNull(ledgerUid);
        List<Asset> rows;
        if (uid != null) {
            Long ledgerId = references.optionalLedger(ownerId, uid);
            rows = assets.findByOwnerIdAndLedgerIdOrderBySortOrderAscIdAsc(ownerId, ledgerId);
        } else {
            rows = includeArchived
                    ? assets.findByOwnerIdOrderBySortOrderAscIdAsc(ownerId)
                    : assets.findByOwnerIdAndArchivedAtIsNullOrderBySortOrderAscIdAsc(ownerId);
        }
        if (!includeArchived) {
            rows = rows.stream().filter(asset -> asset.getArchivedAt() == null).toList();
        }
        RefMaps maps = references.loadMaps(ownerId);
        return rows.stream().map(asset -> toResponse(asset, maps)).toList();
    }

    @Transactional(readOnly = true)
    public AssetDtos.Response get(long ownerId, String clientUid) {
        Asset asset = require(ownerId, clientUid);
        return toResponse(asset, references.loadMaps(ownerId));
    }

    @Transactional
    public AssetDtos.Response upsert(long ownerId, AssetDtos.UpsertRequest request) {
        String uid = Texts.requireNonBlank(request.clientUid(), "clientUid");
        Texts.limit(uid, 64, "clientUid");
        Asset asset = assets.findByOwnerIdAndClientUid(ownerId, uid).orElse(null);
        boolean creating = asset == null;
        if (creating) {
            asset = new Asset();
            asset.setOwnerId(ownerId);
            asset.setClientUid(uid);
            asset.setInitialBalance(BigDecimal.ZERO);
        }
        asset.setLedgerId(references.requiredLedger(ownerId, request.ledgerUid()));
        asset.setName(Texts.requireNonBlank(request.name(), "name"));
        asset.setIcon(Texts.requireNonBlank(request.icon(), "icon"));
        asset.setColor(Texts.requireNonBlank(request.color(), "color"));
        Checks.color(asset.getColor());
        asset.setType(Checks.oneOf(request.type(), TYPES, "type"));
        asset.setCurrency(Texts.upperCurrency(request.currency(), "currency"));
        if (request.initialBalance() != null) {
            asset.setInitialBalance(Money.requireAmount(request.initialBalance(), "initialBalance"));
        }
        applyCredit(asset, request.creditLimit(), request.statementDay(), request.dueDay(),
                request.interestRate());
        asset.setSortOrder(request.sortOrder() == null ? 0 : request.sortOrder());
        applyDefault(ownerId, asset, request.defaultAsset());
        applyArchived(asset, request.archived());
        Asset saved = assets.save(asset);
        return toResponse(saved, references.loadMaps(ownerId));
    }

    @Transactional
    public AssetDtos.Response patch(long ownerId, String clientUid, AssetDtos.PatchRequest request) {
        Asset asset = require(ownerId, clientUid);
        if (request.ledgerUid() != null) {
            asset.setLedgerId(references.requiredLedger(ownerId, request.ledgerUid()));
        }
        if (request.name() != null) {
            asset.setName(Texts.requireNonBlank(request.name(), "name"));
        }
        if (request.icon() != null) {
            asset.setIcon(Texts.requireNonBlank(request.icon(), "icon"));
        }
        if (request.color() != null) {
            asset.setColor(Texts.requireNonBlank(request.color(), "color"));
        }
        if (request.type() != null) {
            asset.setType(Checks.oneOf(request.type(), TYPES, "type"));
        }
        if (request.currency() != null) {
            asset.setCurrency(Texts.upperCurrency(request.currency(), "currency"));
        }
        if (request.initialBalance() != null) {
            asset.setInitialBalance(Money.requireAmount(request.initialBalance(), "initialBalance"));
        }
        applyCredit(asset, request.creditLimit(), request.statementDay(), request.dueDay(),
                request.interestRate());
        if (request.sortOrder() != null) {
            asset.setSortOrder(request.sortOrder());
        }
        applyDefault(ownerId, asset, request.defaultAsset());
        applyArchived(asset, request.archived());
        return toResponse(assets.save(asset), references.loadMaps(ownerId));
    }

    /**
     * Hard delete. History survives: transactions.asset_id / from_asset_id / to_asset_id are
     * ON DELETE SET NULL, so old rows stay readable but stop pointing at a missing account.
     */
    @Transactional
    public void delete(long ownerId, String clientUid) {
        Asset asset = require(ownerId, clientUid);
        assets.delete(asset);
    }

    /** Credit fields belong to type='credit'; nulling them elsewhere keeps the data honest. */
    private static void applyCredit(Asset asset, BigDecimal creditLimit, Integer statementDay, Integer dueDay,
                                    BigDecimal interestRate) {
        boolean credit = "credit".equals(asset.getType());
        asset.setCreditLimit(credit ? Money.optionalAmount(creditLimit, "creditLimit") : null);
        asset.setStatementDay(credit ? Checks.small(statementDay, 1, 31, "statementDay") : null);
        asset.setDueDay(credit ? Checks.small(dueDay, 1, 31, "dueDay") : null);
        if (interestRate != null && interestRate.signum() < 0) {
            throw ApiException.validation("interestRate must not be negative");
        }
        asset.setInterestRate(credit && interestRate != null ? Money.scaleRate(interestRate) : null);
    }

    private void applyDefault(long ownerId, Asset asset, Boolean makeDefault) {
        if (makeDefault == null) {
            return;
        }
        asset.setDefaultAsset(makeDefault);
        if (makeDefault) {
            assets.clearDefaults(ownerId);
        }
    }

    private static void applyArchived(Asset asset, Boolean archived) {
        if (archived == null) {
            return;
        }
        asset.setArchivedAt(archived ? Instant.now() : null);
    }

    private Asset require(long ownerId, String clientUid) {
        String uid = Texts.requireNonBlank(clientUid, "clientUid");
        return assets.findByOwnerIdAndClientUid(ownerId, uid)
                .orElseThrow(() -> ApiException.notFound("Asset not found: " + uid));
    }

    static AssetDtos.Response toResponse(Asset asset, RefMaps maps) {
        return new AssetDtos.Response(
                asset.getClientUid(),
                maps.ledger(asset.getLedgerId()),
                asset.getName(),
                asset.getIcon(),
                asset.getColor(),
                asset.getType(),
                asset.getCurrency(),
                asset.getInitialBalance(),
                asset.getCreditLimit(),
                Checks.unbox(asset.getStatementDay()),
                Checks.unbox(asset.getDueDay()),
                asset.getInterestRate(),
                asset.isDefaultAsset(),
                asset.getSortOrder(),
                asset.getArchivedAt() != null,
                asset.getArchivedAt(),
                asset.getCreatedAt(),
                asset.getUpdatedAt());
    }
}
