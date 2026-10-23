package com.jishiben.api.transaction;

import com.jishiben.api.common.Timestamps;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * One row of the ledger: expense, income, or transfer (a currency exchange is a transfer with a
 * filled-in exchange rate). amount is always the outgoing side; convertedAmount is what lands in the
 * destination account.
 */
@Entity
@Table(name = "transactions")
public class Transaction {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long ownerId;

    @Column(name = "client_uid", nullable = false, length = 64)
    private String clientUid;

    @Column(name = "ledger_id", nullable = false)
    private Long ledgerId;

    @Column(name = "category_id")
    private Long categoryId;

    @Column(name = "asset_id")
    private Long assetId;

    @Column(name = "from_asset_id")
    private Long fromAssetId;

    @Column(name = "to_asset_id")
    private Long toAssetId;

    @Column(nullable = false, length = 16)
    private String type;

    @Column(nullable = false, columnDefinition = "decimal(19,4)")
    private BigDecimal amount;

    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(nullable = false, length = 3)
    private String currency;

    @Column(name = "exchange_rate", columnDefinition = "decimal(19,8)")
    private BigDecimal exchangeRate;

    @Column(name = "converted_amount", columnDefinition = "decimal(19,4)")
    private BigDecimal convertedAmount;

    @Column(columnDefinition = "decimal(19,4)")
    private BigDecimal fee;

    @Column(name = "occurred_on", nullable = false, columnDefinition = "date")
    private LocalDate occurredOn;

    @Column(nullable = false, length = 500)
    private String note = "";

    @Column(name = "display_name", length = 100)
    private String displayName;

    @Column(name = "receipt_path", length = 512)
    private String receiptPath;

    @Column(name = "created_at", nullable = false, columnDefinition = "datetime")
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, columnDefinition = "datetime")
    private Instant updatedAt;

    @PrePersist
    void onCreate() {
        Instant now = Timestamps.now();
        if (createdAt == null) {
            createdAt = now;
        }
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Timestamps.now();
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getOwnerId() {
        return ownerId;
    }

    public void setOwnerId(Long ownerId) {
        this.ownerId = ownerId;
    }

    public String getClientUid() {
        return clientUid;
    }

    public void setClientUid(String clientUid) {
        this.clientUid = clientUid;
    }

    public Long getLedgerId() {
        return ledgerId;
    }

    public void setLedgerId(Long ledgerId) {
        this.ledgerId = ledgerId;
    }

    public Long getCategoryId() {
        return categoryId;
    }

    public void setCategoryId(Long categoryId) {
        this.categoryId = categoryId;
    }

    public Long getAssetId() {
        return assetId;
    }

    public void setAssetId(Long assetId) {
        this.assetId = assetId;
    }

    public Long getFromAssetId() {
        return fromAssetId;
    }

    public void setFromAssetId(Long fromAssetId) {
        this.fromAssetId = fromAssetId;
    }

    public Long getToAssetId() {
        return toAssetId;
    }

    public void setToAssetId(Long toAssetId) {
        this.toAssetId = toAssetId;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public void setAmount(BigDecimal amount) {
        this.amount = amount;
    }

    public String getCurrency() {
        return currency;
    }

    public void setCurrency(String currency) {
        this.currency = currency;
    }

    public BigDecimal getExchangeRate() {
        return exchangeRate;
    }

    public void setExchangeRate(BigDecimal exchangeRate) {
        this.exchangeRate = exchangeRate;
    }

    public BigDecimal getConvertedAmount() {
        return convertedAmount;
    }

    public void setConvertedAmount(BigDecimal convertedAmount) {
        this.convertedAmount = convertedAmount;
    }

    public BigDecimal getFee() {
        return fee;
    }

    public void setFee(BigDecimal fee) {
        this.fee = fee;
    }

    public LocalDate getOccurredOn() {
        return occurredOn;
    }

    public void setOccurredOn(LocalDate occurredOn) {
        this.occurredOn = occurredOn;
    }

    public String getNote() {
        return note;
    }

    public void setNote(String note) {
        this.note = note;
    }

    public String getDisplayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    public String getReceiptPath() {
        return receiptPath;
    }

    public void setReceiptPath(String receiptPath) {
        this.receiptPath = receiptPath;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
