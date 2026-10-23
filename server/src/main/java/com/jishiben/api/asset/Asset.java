package com.jishiben.api.asset;

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
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** A cash / bank / credit / e-wallet / investment / other account. */
@Entity
@Table(name = "assets")
public class Asset {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long ownerId;

    @Column(name = "client_uid", nullable = false, length = 64)
    private String clientUid;

    @Column(name = "ledger_id", nullable = false)
    private Long ledgerId;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(nullable = false, length = 64)
    private String icon;

    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(nullable = false, length = 7)
    private String color;

    @Column(nullable = false, length = 16)
    private String type;

    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(nullable = false, length = 3)
    private String currency;

    @Column(name = "initial_balance", nullable = false, columnDefinition = "decimal(19,4)")
    private BigDecimal initialBalance = BigDecimal.ZERO;

    @Column(name = "credit_limit", columnDefinition = "decimal(19,4)")
    private BigDecimal creditLimit;

    @JdbcTypeCode(SqlTypes.TINYINT)
    @Column(name = "statement_day", columnDefinition = "tinyint unsigned")
    private Short statementDay;

    @JdbcTypeCode(SqlTypes.TINYINT)
    @Column(name = "due_day", columnDefinition = "tinyint unsigned")
    private Short dueDay;

    @Column(name = "interest_rate", columnDefinition = "decimal(9,6)")
    private BigDecimal interestRate;

    @Column(name = "is_default", nullable = false)
    private boolean defaultAsset;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    @Column(name = "archived_at", columnDefinition = "datetime")
    private Instant archivedAt;

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

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getIcon() {
        return icon;
    }

    public void setIcon(String icon) {
        this.icon = icon;
    }

    public String getColor() {
        return color;
    }

    public void setColor(String color) {
        this.color = color;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getCurrency() {
        return currency;
    }

    public void setCurrency(String currency) {
        this.currency = currency;
    }

    public BigDecimal getInitialBalance() {
        return initialBalance;
    }

    public void setInitialBalance(BigDecimal initialBalance) {
        this.initialBalance = initialBalance;
    }

    public BigDecimal getCreditLimit() {
        return creditLimit;
    }

    public void setCreditLimit(BigDecimal creditLimit) {
        this.creditLimit = creditLimit;
    }

    public Short getStatementDay() {
        return statementDay;
    }

    public void setStatementDay(Short statementDay) {
        this.statementDay = statementDay;
    }

    public Short getDueDay() {
        return dueDay;
    }

    public void setDueDay(Short dueDay) {
        this.dueDay = dueDay;
    }

    public BigDecimal getInterestRate() {
        return interestRate;
    }

    public void setInterestRate(BigDecimal interestRate) {
        this.interestRate = interestRate;
    }

    public boolean isDefaultAsset() {
        return defaultAsset;
    }

    public void setDefaultAsset(boolean defaultAsset) {
        this.defaultAsset = defaultAsset;
    }

    public int getSortOrder() {
        return sortOrder;
    }

    public void setSortOrder(int sortOrder) {
        this.sortOrder = sortOrder;
    }

    public Instant getArchivedAt() {
        return archivedAt;
    }

    public void setArchivedAt(Instant archivedAt) {
        this.archivedAt = archivedAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
