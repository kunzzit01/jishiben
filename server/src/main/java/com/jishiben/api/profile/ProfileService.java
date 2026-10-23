package com.jishiben.api.profile;

import com.jishiben.api.common.ApiException;
import com.jishiben.api.common.Texts;
import com.jishiben.api.ledger.Ledger;
import com.jishiben.api.ledger.LedgerRepository;
import java.util.Locale;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Account-level display settings, one row per account, created on first read. */
@Service
public class ProfileService {

    /** Exactly the app's own DateFormat union (src/types/index.ts), so no picker option is rejected. */
    private static final Set<String> DATE_FORMATS =
            Set.of("YYYY/MM/DD", "YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY");

    private final ProfileRepository profiles;
    private final LedgerRepository ledgers;

    public ProfileService(ProfileRepository profiles, LedgerRepository ledgers) {
        this.profiles = profiles;
        this.ledgers = ledgers;
    }

    @Transactional
    public Profile ensure(long ownerId) {
        return profiles.findByOwnerId(ownerId).orElseGet(() -> {
            Profile created = new Profile();
            created.setOwnerId(ownerId);
            return profiles.save(created);
        });
    }

    /** Read-write on purpose: the first read of a fresh account creates its default row. */
    @Transactional
    public ProfileDtos.Response get(long ownerId) {
        return toResponse(ensure(ownerId));
    }

    /** The currency that blank budget currencies inherit at write time. */
    @Transactional
    public String currency(long ownerId) {
        return ensure(ownerId).getCurrency();
    }

    @Transactional
    public ProfileDtos.Response update(long ownerId, ProfileDtos.UpdateRequest request) {
        Profile profile = ensure(ownerId);
        if (request.displayName() != null) {
            profile.setDisplayName(Texts.trimToNull(request.displayName()));
        }
        if (request.currency() != null) {
            profile.setCurrency(Texts.upperCurrency(request.currency(), "currency"));
        }
        if (request.dateFormat() != null) {
            String format = Texts.requireNonBlank(request.dateFormat(), "dateFormat").toUpperCase(Locale.ROOT);
            if (!DATE_FORMATS.contains(format)) {
                throw ApiException.validation("dateFormat must be one of " + DATE_FORMATS);
            }
            profile.setDateFormat(format);
        }
        if (request.weekStartsOn() != null) {
            profile.setWeekStartsOn(request.weekStartsOn().shortValue());
        }
        if (request.decimalPlaces() != null) {
            profile.setDecimalPlaces(request.decimalPlaces().shortValue());
        }
        if (request.periodPreference() != null) {
            profile.setPeriodPreference(request.periodPreference());
        }
        if (request.activeLedgerUid() != null) {
            String uid = Texts.trimToNull(request.activeLedgerUid());
            if (uid == null) {
                profile.setActiveLedgerId(null);
            } else {
                Ledger ledger = ledgers.findByOwnerIdAndClientUid(ownerId, uid)
                        .orElseThrow(() -> ApiException.validation(
                                "activeLedgerUid does not reference one of your ledgers: " + uid));
                profile.setActiveLedgerId(ledger.getId());
            }
        }
        return toResponse(profiles.save(profile));
    }

    @Transactional
    public void clearActiveLedger(long ownerId) {
        profiles.findByOwnerId(ownerId).ifPresent(profile -> {
            profile.setActiveLedgerId(null);
            profiles.save(profile);
        });
    }

    ProfileDtos.Response toResponse(Profile profile) {
        String activeLedgerUid = profile.getActiveLedgerId() == null ? null
                : ledgers.findById(profile.getActiveLedgerId()).map(Ledger::getClientUid).orElse(null);
        return new ProfileDtos.Response(
                profile.getDisplayName(),
                profile.getCurrency(),
                profile.getDateFormat(),
                profile.getWeekStartsOn() == null ? 1 : profile.getWeekStartsOn().intValue(),
                profile.getDecimalPlaces() == null ? 2 : profile.getDecimalPlaces().intValue(),
                profile.getPeriodPreference(),
                activeLedgerUid,
                profile.getUpdatedAt());
    }
}
