package com.jishiben.api.transaction;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TransactionRepository
        extends JpaRepository<Transaction, Long>, JpaSpecificationExecutor<Transaction> {

    Optional<Transaction> findByOwnerIdAndClientUid(Long ownerId, String clientUid);

    List<Transaction> findByOwnerIdAndLedgerId(Long ownerId, Long ledgerId);

    long countByOwnerIdAndLedgerId(Long ownerId, Long ledgerId);

    /** Bulk delete so a forced ledger delete runs in one predictable statement order. */
    @Modifying
    @Query("delete from Transaction t where t.ownerId = :ownerId and t.ledgerId = :ledgerId")
    int deleteAllByLedger(@Param("ownerId") long ownerId, @Param("ledgerId") Long ledgerId);

    /** Income/expense totals per currency. Transfers are excluded on purpose: they move money. */
    @Query(value = """
            SELECT currency, type, SUM(amount), COUNT(*)
            FROM transactions
            WHERE user_id = :ownerId AND occurred_on BETWEEN :from AND :to AND type <> 'transfer'
            GROUP BY currency, type
            """, nativeQuery = true)
    List<Object[]> sumByCurrencyAndType(@Param("ownerId") long ownerId,
                                        @Param("from") LocalDate from,
                                        @Param("to") LocalDate to);

    @Query(value = """
            SELECT currency, category_id, SUM(amount), COUNT(*)
            FROM transactions
            WHERE user_id = :ownerId AND occurred_on BETWEEN :from AND :to
              AND type = 'expense' AND category_id IS NOT NULL
            GROUP BY currency, category_id
            """, nativeQuery = true)
    List<Object[]> sumExpenseByCategory(@Param("ownerId") long ownerId,
                                        @Param("from") LocalDate from,
                                        @Param("to") LocalDate to);

    /** Signle-account movements: transfers never carry asset_id, so they cannot double count here. */
    @Query(value = """
            SELECT asset_id, type, SUM(amount)
            FROM transactions
            WHERE user_id = :ownerId AND asset_id IS NOT NULL
            GROUP BY asset_id, type
            """, nativeQuery = true)
    List<Object[]> sumSingleAssetByType(@Param("ownerId") long ownerId);

    /** Money leaving an account: the outgoing amount plus its fee, exactly as the app deducts it. */
    @Query(value = """
            SELECT from_asset_id, SUM(amount + COALESCE(fee, 0))
            FROM transactions
            WHERE user_id = :ownerId AND from_asset_id IS NOT NULL
            GROUP BY from_asset_id
            """, nativeQuery = true)
    List<Object[]> sumTransferOut(@Param("ownerId") long ownerId);

    /** Money arriving: the converted amount when a rate was used, otherwise the amount itself. */
    @Query(value = """
            SELECT to_asset_id, SUM(COALESCE(converted_amount, amount))
            FROM transactions
            WHERE user_id = :ownerId AND to_asset_id IS NOT NULL
            GROUP BY to_asset_id
            """, nativeQuery = true)
    List<Object[]> sumTransferIn(@Param("ownerId") long ownerId);
}
